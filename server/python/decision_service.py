"""Service layer for the single-label binary workflow."""
from typing import Optional, Dict, Any
from datetime import datetime
from sqlmodel import Session, select
from sqlalchemy import func, distinct
from models import LabelDefinition, LabelApplication, MessageCache

VALID_VALUES = {"yes", "no", "skip"}


def activate_label(session: Session, *, label_id: int) -> None:
    """Make this label active; clear is_active on all others."""
    label = session.get(LabelDefinition, label_id)
    if label is None:
        raise ValueError(f"label {label_id} not found")
    others = session.exec(
        select(LabelDefinition).where(LabelDefinition.is_active == True)  # noqa: E712
    ).all()
    for other in others:
        if other.id != label_id:
            other.is_active = False
            session.add(other)
    label.is_active = True
    if label.phase == "complete":
        label.phase = "labeling"
    session.add(label)
    session.commit()


def close_label(session: Session, *, label_id: int) -> None:
    label = session.get(LabelDefinition, label_id)
    if label is None:
        raise ValueError(f"label {label_id} not found")
    label.is_active = False
    label.phase = "complete"
    session.add(label)
    session.commit()


def decide(
    session: Session,
    *,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    value: str,
    applied_by: str = "human",
    confidence: Optional[float] = None,
) -> LabelApplication:
    if value not in VALID_VALUES:
        raise ValueError(f"value must be one of {VALID_VALUES}, got {value!r}")
    existing = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == label_id,
            LabelApplication.chatlog_id == chatlog_id,
            LabelApplication.message_index == message_index,
        )
    ).first()
    if existing is not None:
        existing.value = value
        existing.applied_by = applied_by
        existing.confidence = confidence
        existing.created_at = datetime.utcnow()
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing
    row = LabelApplication(
        label_id=label_id,
        chatlog_id=chatlog_id,
        message_index=message_index,
        value=value,
        applied_by=applied_by,
        confidence=confidence,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def undo_last(session: Session, *, label_id: int) -> Optional[Dict[str, int]]:
    """Remove the most recent human decision for this label. Returns the address removed, or None."""
    row = session.exec(
        select(LabelApplication)
        .where(LabelApplication.label_id == label_id, LabelApplication.applied_by == "human")
        .order_by(LabelApplication.created_at.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    addr = {"chatlog_id": row.chatlog_id, "message_index": row.message_index}
    session.delete(row)
    session.commit()
    return addr


def readiness(session: Session, *, label_id: int) -> Dict[str, Any]:
    counts = {"yes_count": 0, "no_count": 0, "skip_count": 0}
    rows = session.exec(
        select(LabelApplication.value, func.count())
        .where(LabelApplication.label_id == label_id, LabelApplication.applied_by == "human")
        .group_by(LabelApplication.value)
    ).all()
    for value, count in rows:
        counts[f"{value}_count"] = count

    total_convs = session.exec(
        select(func.count(distinct(MessageCache.chatlog_id)))
    ).one()

    # Walked = conversations where every student message has a decision
    decided_per_conv = session.exec(
        select(LabelApplication.chatlog_id, func.count())
        .where(LabelApplication.label_id == label_id)
        .group_by(LabelApplication.chatlog_id)
    ).all()
    msgs_per_conv = dict(session.exec(
        select(MessageCache.chatlog_id, func.count())
        .group_by(MessageCache.chatlog_id)
    ).all())
    walked = sum(
        1
        for cid, decided in decided_per_conv
        if msgs_per_conv.get(cid, 0) > 0 and decided >= msgs_per_conv[cid]
    )

    ready = counts["yes_count"] >= 1 and counts["no_count"] >= 1
    return {
        **counts,
        "conversations_walked": walked,
        "total_conversations": total_convs,
        "ready": ready,
    }
