"""Local-ML assist for /run: in-memory cosine nearest-neighbors over
MessageEmbedding. Loads the full embedding matrix once per engine and recomputes
neighbors per-request via a single numpy matmul. No DB writes, no cache table."""
from __future__ import annotations

import threading

import numpy as np
from sqlalchemy import func
from sqlmodel import Session, select

from models import LabelApplication, MessageCache, MessageEmbedding


_lock = threading.Lock()


def _build_cache(db: Session) -> dict:
    rows = db.exec(
        select(
            MessageEmbedding.chatlog_id,
            MessageEmbedding.message_index,
            MessageEmbedding.embedding,
        )
    ).all()
    if not rows:
        return {"matrix": None, "keys_idx": {}, "count": 0}
    keys = [(c, i) for (c, i, _) in rows]
    vecs = np.stack([np.frombuffer(b, dtype=np.float32) for (_, _, b) in rows])
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix = (vecs / norms).astype(np.float32)
    return {
        "matrix": matrix,
        "keys_idx": {k: i for i, k in enumerate(keys)},
        "count": len(rows),
    }


def _get_cache(db: Session) -> dict:
    """Per-engine cached matrix; reloads when MessageEmbedding row count diverges."""
    bind = db.get_bind()
    current = db.exec(select(func.count()).select_from(MessageEmbedding)).one()
    with _lock:
        cache = bind.info.get("assist_cache") if hasattr(bind, "info") else None
        if cache is not None and cache["count"] == current:
            return cache
        cache = _build_cache(db)
        if hasattr(bind, "info"):
            bind.info["assist_cache"] = cache
        return cache


def nearest_neighbors(
    db: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    k: int = 3,
) -> list[dict]:
    """Up to k cosine-nearest human yes/no labeled neighbors of the focused message.
    Returns [] if the focused message has no embedding or no labeled neighbors do.
    Each result: {chatlog_id, message_index, value, similarity, message_text}."""
    cache = _get_cache(db)
    if cache["matrix"] is None:
        return []
    keys_idx = cache["keys_idx"]
    matrix = cache["matrix"]

    focused_idx = keys_idx.get((chatlog_id, message_index))
    if focused_idx is None:
        return []
    focused = matrix[focused_idx]

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

    candidate_idx: list[int] = []
    candidate_meta: list[tuple[int, int, str]] = []
    for cid, midx, value in apps:
        if cid == chatlog_id and midx == message_index:
            continue
        idx = keys_idx.get((cid, midx))
        if idx is None:
            continue
        candidate_idx.append(idx)
        candidate_meta.append((cid, midx, value))
    if not candidate_idx:
        return []

    sub = matrix[candidate_idx]
    sims = sub @ focused

    k_eff = min(k, len(sims))
    top_part = np.argpartition(-sims, k_eff - 1)[:k_eff]
    top_local = top_part[np.argsort(-sims[top_part])]

    top: list[dict] = []
    for li in top_local:
        cid, midx, value = candidate_meta[int(li)]
        top.append({
            "chatlog_id": cid,
            "message_index": midx,
            "value": value,
            "similarity": float(sims[int(li)]),
        })

    text_keys = {(t["chatlog_id"], t["message_index"]) for t in top}
    if text_keys:
        msgs = db.exec(
            select(
                MessageCache.chatlog_id,
                MessageCache.message_index,
                MessageCache.message_text,
            ).where(MessageCache.chatlog_id.in_({c for c, _ in text_keys}))
        ).all()
        text_map = {(c, i): t for (c, i, t) in msgs}
        for t in top:
            t["message_text"] = text_map.get(
                (t["chatlog_id"], t["message_index"]), ""
            )

    return top


def rebuild_cache_if_stale(db: Session, label_id: int) -> bool:
    """No-op kept for callsite compatibility. The in-memory matrix reloads
    automatically inside nearest_neighbors() when MessageEmbedding count diverges."""
    return False


def get_cached_neighbors(
    db: Session, label_id: int, chatlog_id: int, message_index: int
) -> list[dict]:
    return nearest_neighbors(db, label_id, chatlog_id, message_index, k=3)
