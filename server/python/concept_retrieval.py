"""Pure retrieval primitives for RAG-style concept discovery.

No Gemini calls here except deterministic embeddings.
No DB writes; only DB reads.
"""
from __future__ import annotations
from typing import Any, TypedDict

import numpy as np
from sqlmodel import Session, select

from models import (
    LabelApplication,
    LabelDefinition,
    MessageCache,
)


class Message(TypedDict):
    chatlog_id: int
    message_index: int
    message_text: str


class CoOccurrencePair(TypedDict):
    label_a_id: int
    label_b_id: int
    label_a_name: str
    label_b_name: str
    count: int
    example_message_ids: list[dict[str, int]]


def thinly_labeled_pool(db: Session) -> list[Message]:
    """Mode A corpus: messages with NO human LabelApplications.

    AI-only applications do not count as labeled — discovery's purpose
    is to find what instructor intent doesn't yet cover.
    """
    human_labeled = {
        (chatlog_id, message_index)
        for chatlog_id, message_index in db.exec(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .where(LabelApplication.applied_by == "human")
            .distinct()
        ).all()
    }

    rows = db.exec(
        select(
            MessageCache.chatlog_id,
            MessageCache.message_index,
            MessageCache.message_text,
        )
    ).all()

    return [
        {
            "chatlog_id": chatlog_id,
            "message_index": message_index,
            "message_text": message_text,
        }
        for chatlog_id, message_index, message_text in rows
        if (chatlog_id, message_index) not in human_labeled
    ]


def select_diverse(vectors: np.ndarray, k: int) -> list[int]:
    """Greedy max-min farthest-point sampling. No clustering.

    Seed with index 0, then iteratively add the index whose minimum
    distance to already-selected vectors is largest. Returns indices
    in selection order. If k >= len(vectors), returns all indices in
    selection order.
    """
    n = len(vectors)
    if n == 0:
        return []
    k = min(k, n)
    chosen = [0]
    min_dists = np.linalg.norm(vectors - vectors[0], axis=1)
    while len(chosen) < k:
        # Mask already-chosen indices so they cannot be re-picked.
        masked = min_dists.copy()
        masked[chosen] = -1.0
        next_idx = int(np.argmax(masked))
        chosen.append(next_idx)
        new_dists = np.linalg.norm(vectors - vectors[next_idx], axis=1)
        min_dists = np.minimum(min_dists, new_dists)
    return chosen


def _normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-9
    return vectors / norms


def _embed_messages(messages: list[Message], db: Session) -> np.ndarray:
    """Wrapper around the existing concept_service.embed_messages helper.

    Imported lazily to avoid a circular import.
    """
    from concept_service import embed_messages
    return embed_messages(messages, db)


def _embed_label_definitions(
    labels: list[LabelDefinition], db: Session,
) -> np.ndarray:
    """Embed `name: description` strings for each active label.

    Not cached in MessageEmbedding (different content type); cheap
    because label counts are small.
    """
    if not labels:
        return np.zeros((0, 0), dtype=np.float32)
    from concept_service import client, EMBED_MODEL
    texts = [
        f"{l.name}: {l.description or ''}".strip()
        for l in labels
    ]
    result = client.models.embed_content(model=EMBED_MODEL, contents=texts)
    return np.array([e.values for e in result.embeddings], dtype=np.float32)


def retrieve_residual(
    db: Session,
    threshold: float = 0.55,
    target_size: int = 80,
) -> list[Message]:
    """Mode A retrieval. Score each pool message by max cosine sim to any
    active LabelDefinition embedding; keep messages whose max sim is
    below `threshold`. Run max-min diversity selection on the residual
    to pick `target_size` messages spanning it.
    """
    pool = thinly_labeled_pool(db)
    if not pool:
        return []

    msg_vecs = _embed_messages(pool, db)

    active_labels = list(
        db.exec(
            select(LabelDefinition).where(LabelDefinition.archived_at == None)  # noqa: E711
        ).all()
    )
    label_vecs = _embed_label_definitions(active_labels, db)

    if label_vecs.size == 0:
        residual_indices = list(range(len(pool)))
    else:
        msg_normed = _normalize(msg_vecs)
        label_normed = _normalize(label_vecs)
        sim = msg_normed @ label_normed.T  # (n_msgs, n_labels)
        max_sim = sim.max(axis=1)
        residual_indices = [i for i, s in enumerate(max_sim) if s < threshold]

    if not residual_indices:
        return []

    residual_vecs = msg_vecs[residual_indices]
    diverse_local = select_diverse(residual_vecs, k=target_size)
    chosen = [residual_indices[i] for i in diverse_local]
    return [pool[i] for i in chosen]


def retrieve_co_occurrence(
    db: Session, min_count: int = 8,
) -> list[CoOccurrencePair]:
    """Mode B retrieval. Find pairs of human-applied labels that
    co-occur on >= min_count messages. Returns pair rows with example
    message keys.
    """
    rows = db.exec(
        select(
            LabelApplication.chatlog_id,
            LabelApplication.message_index,
            LabelApplication.label_id,
        ).where(LabelApplication.applied_by == "human")
    ).all()

    by_msg: dict[tuple[int, int], set[int]] = {}
    for chatlog_id, message_index, label_id in rows:
        by_msg.setdefault((chatlog_id, message_index), set()).add(label_id)

    pair_counts: dict[tuple[int, int], int] = {}
    pair_examples: dict[tuple[int, int], list[dict[str, int]]] = {}
    for msg_key, label_ids in by_msg.items():
        ids = sorted(label_ids)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                pk = (ids[i], ids[j])
                pair_counts[pk] = pair_counts.get(pk, 0) + 1
                pair_examples.setdefault(pk, []).append(
                    {"chatlog_id": msg_key[0], "message_index": msg_key[1]}
                )

    active = {
        l.id: l.name
        for l in db.exec(
            select(LabelDefinition).where(LabelDefinition.archived_at == None)  # noqa: E711
        ).all()
    }

    out: list[CoOccurrencePair] = []
    for (a_id, b_id), count in pair_counts.items():
        if count < min_count:
            continue
        if a_id not in active or b_id not in active:
            continue
        out.append({
            "label_a_id": a_id,
            "label_b_id": b_id,
            "label_a_name": active[a_id],
            "label_b_name": active[b_id],
            "count": count,
            "example_message_ids": pair_examples[(a_id, b_id)][:5],
        })
    out.sort(key=lambda p: p["count"], reverse=True)
    return out
