"""Concept discovery orchestrator.

embed_messages() is preserved for use by concept_retrieval. The
old KMeans-based discover_concepts() pipeline has been removed in
favor of the RAG-style discover() orchestrator below.
"""
import os
import json
from datetime import datetime
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import numpy as np
from google import genai
from sqlmodel import Session, func, select

from models import (
    ConceptCandidate, DiscoveryRun, LabelApplication, LabelDefinition,
    MessageEmbedding,
)


client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

EMBED_MODEL = "gemini-embedding-001"
EMBED_DIM = 3072
EMBED_BATCH_SIZE = 100  # Gemini API limit per call


def embed_messages(
    messages: List[Dict[str, Any]], db: Session,
) -> np.ndarray:
    """Embed messages, using cached embeddings where available.

    Each message dict must have: chatlog_id, message_index, message_text.
    Returns a (len(messages), EMBED_DIM) float32 array.
    """
    vectors = np.zeros((len(messages), EMBED_DIM), dtype=np.float32)
    uncached_indices: List[int] = []

    for i, msg in enumerate(messages):
        cached = db.exec(
            select(MessageEmbedding).where(
                MessageEmbedding.chatlog_id == msg["chatlog_id"],
                MessageEmbedding.message_index == msg["message_index"],
                MessageEmbedding.model_version == EMBED_MODEL,
            )
        ).first()
        if cached:
            vectors[i] = np.frombuffer(cached.embedding, dtype=np.float32)
        else:
            uncached_indices.append(i)

    if not uncached_indices:
        return vectors

    for batch_start in range(0, len(uncached_indices), EMBED_BATCH_SIZE):
        batch_idx = uncached_indices[batch_start : batch_start + EMBED_BATCH_SIZE]
        texts = [messages[i]["message_text"] for i in batch_idx]

        result = client.models.embed_content(
            model=EMBED_MODEL,
            contents=texts,
        )

        for j, idx in enumerate(batch_idx):
            vec = np.array(result.embeddings[j].values, dtype=np.float32)
            vectors[idx] = vec
            row = MessageEmbedding(
                chatlog_id=messages[idx]["chatlog_id"],
                message_index=messages[idx]["message_index"],
                embedding=vec.tobytes(),
                model_version=EMBED_MODEL,
            )
            db.add(row)

    db.commit()
    return vectors


# ── RAG-style discovery orchestrator ───────────────────────────────

from concept_retrieval import retrieve_residual, retrieve_co_occurrence
from concept_generation import (
    generate_broad_labels, generate_co_occurrence_concepts,
)


@dataclass
class AcceptResult:
    candidate_id: int
    created_label_id: int
    applied_count: int


def _read_recalibration_due(db: Session) -> bool:
    """Returns True if the PR #36 recalibration system says drift is up.
    Lazily imports from main to avoid a top-level circular dependency."""
    from main import _compute_recalibration_interval
    from models import RecalibrationEvent, LabelingSession

    session_row = db.exec(
        select(LabelingSession).order_by(LabelingSession.id.desc())
    ).first()
    if not session_row:
        return False

    events = list(db.exec(
        select(RecalibrationEvent).order_by(RecalibrationEvent.id.asc())
    ).all())
    interval = _compute_recalibration_interval(events)
    cutoff = events[-1].created_at if events else session_row.started_at

    labeled_since = db.exec(
        select(func.count()).select_from(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .where(LabelApplication.applied_by == "human")
            .where(LabelApplication.created_at > cutoff)
            .distinct()
            .subquery()
        )
    ).one()
    return labeled_since >= interval


def _persist_drafts(
    drafts: list[dict], run: DiscoveryRun, db: Session,
) -> list[ConceptCandidate]:
    out: list[ConceptCandidate] = []
    for d in drafts:
        cc = ConceptCandidate(
            name=d["name"],
            description=d.get("description", ""),
            example_messages=json.dumps([{"excerpt": ""}]),  # legacy column
            source_run_id=str(run.id),  # legacy column
            kind=d["kind"],
            discovery_run_id=run.id,
            evidence_message_ids=(
                json.dumps(d["evidence_message_ids"])
                if d.get("evidence_message_ids") is not None else None
            ),
            co_occurrence_label_ids=(
                json.dumps(d["co_occurrence_label_ids"])
                if d.get("co_occurrence_label_ids") is not None else None
            ),
            co_occurrence_count=d.get("co_occurrence_count"),
        )
        db.add(cc)
        out.append(cc)
    db.commit()
    for cc in out:
        db.refresh(cc)
    return out


def discover(
    db: Session,
    query_kind: str,
    trigger: str,
    *,
    threshold: float = 0.55,
    target_size: int = 80,
    min_count: int = 8,
) -> DiscoveryRun:
    """Orchestrates one discovery run end-to-end. Always finalizes the
    run (sets completed_at and either n_candidates or error)."""
    run = DiscoveryRun(
        query_kind=query_kind,
        trigger=trigger,
        pool_size_at_trigger=0,  # filled in below
        drift_value_at_trigger=None,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        try:
            run.drift_value_at_trigger = (
                1.0 if _read_recalibration_due(db) else 0.0
            )
        except Exception:
            run.drift_value_at_trigger = None

        if query_kind == "broad_label":
            retrieved = retrieve_residual(
                db, threshold=threshold, target_size=target_size,
            )
            run.pool_size_at_trigger = len(retrieved)
            existing = [
                {"name": l.name, "description": l.description or "", "id": l.id}
                for l in db.exec(
                    select(LabelDefinition).where(
                        LabelDefinition.archived_at == None  # noqa: E711
                    )
                ).all()
            ]
            rejected = [
                cc.name for cc in db.exec(
                    select(ConceptCandidate).where(
                        ConceptCandidate.decision == "reject"
                    )
                ).all()
            ]
            drafts = generate_broad_labels(retrieved, existing, rejected)
        elif query_kind == "co_occurrence":
            pairs = retrieve_co_occurrence(db, min_count=min_count)
            run.pool_size_at_trigger = len(pairs)
            existing = [
                {"name": l.name, "description": l.description or "", "id": l.id}
                for l in db.exec(
                    select(LabelDefinition).where(
                        LabelDefinition.archived_at == None  # noqa: E711
                    )
                ).all()
            ]
            drafts = generate_co_occurrence_concepts(pairs, existing)
        else:
            raise ValueError(f"unknown query_kind: {query_kind}")

        candidates = _persist_drafts(drafts, run, db)
        run.n_candidates = len(candidates)
    except Exception as e:
        run.error = str(e)
    finally:
        run.completed_at = datetime.utcnow()
        db.add(run)
        db.commit()
        db.refresh(run)
    return run


def accept_broad_label(candidate_id: int, db: Session) -> AcceptResult:
    """Mode A acceptance:
    1. Create a LabelDefinition from the candidate.
    2. Auto-apply it to evidence messages with applied_by='ai',
       confidence=0.6.
    3. Set candidate.decision='accept', decided_at, created_label_id.
    """
    cc = db.get(ConceptCandidate, candidate_id)
    if cc is None:
        raise ValueError(f"candidate {candidate_id} not found")
    if cc.kind != "broad_label":
        raise ValueError(
            f"accept_broad_label requires kind='broad_label', got '{cc.kind}'"
        )
    if cc.decision in ("accept", "dismiss", "reject"):
        raise ValueError(
            f"candidate {candidate_id} already decided: {cc.decision}"
        )

    new_label = LabelDefinition(
        name=cc.name, description=cc.description or None,
    )
    db.add(new_label)
    db.commit()
    db.refresh(new_label)

    evidence: list[dict] = []
    if cc.evidence_message_ids:
        try:
            evidence = json.loads(cc.evidence_message_ids)
        except (TypeError, ValueError):
            evidence = []

    applied = 0
    for ev in evidence:
        try:
            chatlog_id = int(ev["chatlog_id"])
            message_index = int(ev["message_index"])
        except (KeyError, TypeError, ValueError):
            continue
        db.add(LabelApplication(
            chatlog_id=chatlog_id,
            message_index=message_index,
            label_id=new_label.id,
            applied_by="ai",
            confidence=0.6,
        ))
        applied += 1

    cc.decision = "accept"
    cc.decided_at = datetime.utcnow()
    cc.created_label_id = new_label.id
    cc.status = "accepted"  # legacy column for backwards compat
    db.add(cc)
    db.commit()

    return AcceptResult(
        candidate_id=cc.id,
        created_label_id=new_label.id,
        applied_count=applied,
    )


def is_discovery_ripe(db: Session, min_pool: int = 30) -> dict:
    """Returns a JSON-friendly ripeness signal. Cheap; safe to poll."""
    from concept_retrieval import thinly_labeled_pool
    pool = thinly_labeled_pool(db)
    pool_size = len(pool)

    drift_due = False
    drift_value: Optional[float] = None
    try:
        drift_due = _read_recalibration_due(db)
        drift_value = 1.0 if drift_due else 0.0
    except Exception:
        drift_value = None

    reasons: list[str] = []
    if pool_size < min_pool:
        reasons.append("pool_below_threshold")
    if not drift_due:
        reasons.append("drift_low")
    ripe = pool_size >= min_pool and drift_due
    if ripe:
        reasons = ["ok"]
    return {
        "ripe": ripe,
        "pool_size": pool_size,
        "drift_value": drift_value,
        "reasons": reasons,
    }
