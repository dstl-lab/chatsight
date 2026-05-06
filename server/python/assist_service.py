"""Local-ML assist for /run: cosine-nearest labeled neighbors over cached embeddings.
No external API calls, no fitted classifier — just retrieval over MessageEmbedding."""
from __future__ import annotations

import json as _json

import numpy as np
from sqlalchemy import func
from sqlmodel import Session, select

from models import (
    LabelApplication,
    LabelPrediction,
    MessageCache,
    MessageEmbedding,
)


def _decode(emb_bytes: bytes) -> np.ndarray:
    return np.frombuffer(emb_bytes, dtype=np.float32)


def nearest_neighbors(
    db: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    k: int = 3,
) -> list[dict]:
    """Return up to k cosine-nearest labeled neighbors of the given message.
    Each result: {chatlog_id, message_index, value, similarity, message_text}.
    Returns [] if the focused message has no cached embedding or there are no
    labeled neighbors. Skip-decisions are excluded — only yes/no count."""
    focused_emb_row = db.exec(
        select(MessageEmbedding).where(
            MessageEmbedding.chatlog_id == chatlog_id,
            MessageEmbedding.message_index == message_index,
        )
    ).first()
    if not focused_emb_row:
        return []
    focused = _decode(focused_emb_row.embedding)
    focused_norm = float(np.linalg.norm(focused))
    if focused_norm == 0.0:
        return []

    apps = db.exec(
        select(
            LabelApplication.chatlog_id,
            LabelApplication.message_index,
            LabelApplication.value,
        ).where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
            LabelApplication.value.in_(["yes", "no"]),  # noqa: comparator
        )
    ).all()
    # Exclude the focused message from its own neighbor pool (e.g., on undo
    # or post-decision navigation, a labeled message may be re-focused).
    apps = [(c, i, v) for (c, i, v) in apps if not (c == chatlog_id and i == message_index)]
    if not apps:
        return []

    candidates: list[dict] = []
    for cid, midx, value in apps:
        emb_row = db.exec(
            select(MessageEmbedding).where(
                MessageEmbedding.chatlog_id == cid,
                MessageEmbedding.message_index == midx,
            )
        ).first()
        if not emb_row:
            continue
        v = _decode(emb_row.embedding)
        denom = focused_norm * float(np.linalg.norm(v))
        if denom == 0.0:
            continue
        sim = float(np.dot(focused, v) / denom)
        candidates.append({
            "chatlog_id": cid,
            "message_index": midx,
            "value": value,
            "similarity": sim,
        })

    candidates.sort(key=lambda c: c["similarity"], reverse=True)
    top = candidates[:k]

    for c in top:
        msg = db.exec(
            select(MessageCache).where(
                MessageCache.chatlog_id == c["chatlog_id"],
                MessageCache.message_index == c["message_index"],
            )
        ).first()
        c["message_text"] = msg.message_text if msg else ""

    return top


# ---------------------------------------------------------------------------
# Cache rebuild helpers
# ---------------------------------------------------------------------------

REBUILD_DIVERGENCE = 5


def _human_label_count(db: Session, label_id: int) -> int:
    """SELECT COUNT(*) — runs on every /next call, must not load rows."""
    return db.exec(
        select(func.count()).select_from(LabelApplication).where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
            LabelApplication.value.in_(["yes", "no"]),  # noqa: comparator
        )
    ).one()


def _latest_model_version(db: Session, label_id: int) -> int | None:
    row = db.exec(
        select(LabelPrediction.model_version)
        .where(LabelPrediction.label_id == label_id)
        .limit(1)
    ).first()
    return row if row is not None else None


def rebuild_cache_if_stale(db: Session, label_id: int) -> bool:
    """If the per-label human-label count has diverged from the cached
    model_version by >= REBUILD_DIVERGENCE (or no cache exists), wipe and
    rebuild the LabelPrediction rows for this label. Returns True if a
    rebuild ran."""
    current = _human_label_count(db, label_id)
    cached = _latest_model_version(db, label_id)

    if cached is None and current < REBUILD_DIVERGENCE:
        # Below the cold-start threshold, no cache yet — leave it.
        return False
    if cached is not None and (current - cached) < REBUILD_DIVERGENCE:
        return False

    # Wipe existing rows for this label.
    existing = db.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label_id)
    ).all()
    for row in existing:
        db.delete(row)
    db.commit()

    # Compute pending = cached messages minus already-labeled ones.
    decided = set(db.exec(
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .where(LabelApplication.label_id == label_id)
    ).all())
    cached_msgs = db.exec(
        select(MessageCache.chatlog_id, MessageCache.message_index)
    ).all()
    pending = [(c, i) for (c, i) in cached_msgs if (c, i) not in decided]

    for cid, midx in pending:
        neighbors = nearest_neighbors(db, label_id, cid, midx, k=3)
        db.add(LabelPrediction(
            label_id=label_id,
            chatlog_id=cid,
            message_index=midx,
            nearest_neighbors=_json.dumps(neighbors),
            model_version=current,
        ))
    db.commit()
    return True


def get_cached_neighbors(
    db: Session, label_id: int, chatlog_id: int, message_index: int
) -> list[dict]:
    """Return the cached neighbors for a (label, message), or [] if no cache row."""
    row = db.exec(
        select(LabelPrediction).where(
            LabelPrediction.label_id == label_id,
            LabelPrediction.chatlog_id == chatlog_id,
            LabelPrediction.message_index == message_index,
        )
    ).first()
    if not row:
        return []
    try:
        return list(_json.loads(row.nearest_neighbors))
    except (ValueError, TypeError):
        return []
