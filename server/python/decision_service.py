"""Single-label binary decisions: yes / no / skip + undo + readiness math."""
from datetime import datetime
from typing import Optional, Tuple

from sqlmodel import Session, select

from models import (
    ConversationCursor,
    LabelApplication,
    LabelDefinition,
    MessageCache,
)


VALID_DECISIONS = {"yes", "no", "skip"}


def record_decision(
    session: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    value: str,
) -> LabelApplication:
    """Record a human decision for a single-label binary classification.

    Idempotent: re-deciding the same (label, chatlog, message) updates the existing row.
    """
    if value not in VALID_DECISIONS:
        raise ValueError(f"Invalid decision value: {value!r}")

    existing = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == label_id,
            LabelApplication.chatlog_id == chatlog_id,
            LabelApplication.message_index == message_index,
        )
    ).first()

    if existing:
        existing.value = value
        existing.applied_by = "human"
        existing.confidence = 1.0
        existing.created_at = datetime.utcnow()
        session.add(existing)
        app = existing
    else:
        app = LabelApplication(
            label_id=label_id,
            chatlog_id=chatlog_id,
            message_index=message_index,
            applied_by="human",
            confidence=1.0,
            value=value,
        )
        session.add(app)

    cursor = session.exec(
        select(ConversationCursor).where(
            ConversationCursor.label_id == label_id,
            ConversationCursor.chatlog_id == chatlog_id,
        )
    ).first()
    if cursor:
        cursor.last_message_index_decided = max(
            cursor.last_message_index_decided, message_index
        )
        cursor.updated_at = datetime.utcnow()
        session.add(cursor)
    else:
        session.add(
            ConversationCursor(
                label_id=label_id,
                chatlog_id=chatlog_id,
                last_message_index_decided=message_index,
            )
        )

    session.commit()
    session.refresh(app)
    return app


def undo_last_decision(session: Session, label_id: int) -> Optional[LabelApplication]:
    """Reverse the most recent human decision for this label. Returns the deleted row, or None."""
    last = session.exec(
        select(LabelApplication)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
        )
        .order_by(LabelApplication.created_at.desc())  # type: ignore[arg-type]
    ).first()
    if not last:
        return None

    snapshot = LabelApplication(
        id=last.id,
        label_id=last.label_id,
        chatlog_id=last.chatlog_id,
        message_index=last.message_index,
        applied_by=last.applied_by,
        confidence=last.confidence,
        created_at=last.created_at,
        value=last.value,
    )
    session.delete(last)
    session.commit()
    return snapshot


def compute_readiness(session: Session, label_id: int) -> dict:
    """Compute readiness state for the active label.

    Tiers:
    - gray:  yes_count == 0 OR no_count == 0 (handoff disabled)
    - amber: yes >= 1 AND no >= 1 AND conversations_walked < 5 (allowed but discouraged)
    - green: yes >= 1 AND no >= 1 AND conversations_walked >= 5 (encouraged)
    """
    rows = session.exec(
        select(LabelApplication.value, LabelApplication.chatlog_id)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
        )
    ).all()

    yes = sum(1 for v, _ in rows if v == "yes")
    no = sum(1 for v, _ in rows if v == "no")
    skip = sum(1 for v, _ in rows if v == "skip")

    walked = len({c for _, c in rows})

    total_convs = session.exec(
        select(MessageCache.chatlog_id).distinct()
    ).all()
    total_convs_count = len(total_convs)

    if yes == 0 or no == 0:
        tier = "gray"
        hint = "Need at least one Yes and one No before handoff is allowed."
    elif walked < 5:
        tier = "amber"
        hint = f"Walk {5 - walked} more conversation(s) for a green tier."
    else:
        tier = "green"
        hint = None

    return {
        "tier": tier,
        "yes_count": yes,
        "no_count": no,
        "skip_count": skip,
        "conversations_walked": walked,
        "total_conversations": total_convs_count,
        "hint": hint,
    }


def skip_conversation(session: Session, label_id: int, chatlog_id: int) -> int:
    """Skip every still-undecided student message in `chatlog_id` for this label by
    writing `LabelApplication(applied_by="human", value="skip")` rows. Returns the
    count of newly-written skip rows. Already-decided messages are left alone."""
    cache_rows = session.exec(
        select(MessageCache.message_index).where(MessageCache.chatlog_id == chatlog_id)
    ).all()
    decided = set(
        session.exec(
            select(LabelApplication.message_index)
            .where(
                LabelApplication.label_id == label_id,
                LabelApplication.chatlog_id == chatlog_id,
            )
        ).all()
    )
    skipped = 0
    for midx in cache_rows:
        if midx in decided:
            continue
        session.add(LabelApplication(
            label_id=label_id,
            chatlog_id=chatlog_id,
            message_index=midx,
            applied_by="human",
            confidence=1.0,
            value="skip",
        ))
        skipped += 1

    cursor = session.exec(
        select(ConversationCursor).where(
            ConversationCursor.label_id == label_id,
            ConversationCursor.chatlog_id == chatlog_id,
        )
    ).first()
    if cache_rows:
        last_idx = max(cache_rows)
        if cursor:
            cursor.last_message_index_decided = max(
                cursor.last_message_index_decided, last_idx
            )
            cursor.updated_at = datetime.utcnow()
            session.add(cursor)
        else:
            session.add(ConversationCursor(
                label_id=label_id,
                chatlog_id=chatlog_id,
                last_message_index_decided=last_idx,
            ))
    session.commit()
    return skipped


def label_counts(session: Session, label_id: int) -> Tuple[int, int, int, int]:
    """Return (yes, no, skip, conversations_walked) for a label, all `applied_by="human"`."""
    rows = session.exec(
        select(LabelApplication.value, LabelApplication.chatlog_id)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
        )
    ).all()
    yes = sum(1 for v, _ in rows if v == "yes")
    no = sum(1 for v, _ in rows if v == "no")
    skip = sum(1 for v, _ in rows if v == "skip")
    walked = len({c for _, c in rows})
    return yes, no, skip, walked
