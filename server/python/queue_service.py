"""Queue ordering for the single-label workflow.

Walks one conversation start-to-end before jumping to the next.
Conversations with at least one decided message are continued first.
"""
from typing import Optional, Dict, Any
from sqlmodel import Session, select
from sqlalchemy import and_, exists
from models import MessageCache, LabelApplication


def next_undecided_message(session: Session, *, label_id: int) -> Optional[Dict[str, Any]]:
    """Return the next student message with no decision for this label.

    Ordering:
      1. In-progress conversations (some decided messages) before not-started.
      2. Within priority class, conversations ordered by chatlog_id ascending.
      3. Within a conversation, messages ordered by message_index ascending.
    """
    decided_subq = (
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .where(LabelApplication.label_id == label_id)
        .subquery()
    )

    has_any_decided_subq = (
        select(LabelApplication.chatlog_id)
        .where(LabelApplication.label_id == label_id)
        .distinct()
        .subquery()
    )

    # In-progress convos: have at least one decided message
    in_progress = (
        select(MessageCache)
        .where(MessageCache.chatlog_id.in_(select(has_any_decided_subq.c.chatlog_id)))
        .where(
            ~exists().where(
                and_(
                    decided_subq.c.chatlog_id == MessageCache.chatlog_id,
                    decided_subq.c.message_index == MessageCache.message_index,
                )
            )
        )
        .order_by(MessageCache.chatlog_id, MessageCache.message_index)
        .limit(1)
    )
    row = session.exec(in_progress).first()
    if row is not None:
        return {
            "chatlog_id": row.chatlog_id,
            "message_index": row.message_index,
            "message_text": row.message_text,
            "context_before": row.context_before,
            "context_after": row.context_after,
        }

    # Not-started convos: no decided messages
    not_started = (
        select(MessageCache)
        .where(~MessageCache.chatlog_id.in_(select(has_any_decided_subq.c.chatlog_id)))
        .order_by(MessageCache.chatlog_id, MessageCache.message_index)
        .limit(1)
    )
    row = session.exec(not_started).first()
    if row is None:
        return None
    return {
        "chatlog_id": row.chatlog_id,
        "message_index": row.message_index,
        "message_text": row.message_text,
        "context_before": row.context_before,
        "context_after": row.context_after,
    }


def conversation_context(session: Session, *, chatlog_id: int, up_to_message_index: int) -> list[Dict[str, Any]]:
    """Return all student messages in this conversation up to (and including)
    the given index, in order. Used to render the hybrid view's prior turns.
    """
    rows = session.exec(
        select(MessageCache)
        .where(MessageCache.chatlog_id == chatlog_id)
        .where(MessageCache.message_index <= up_to_message_index)
        .order_by(MessageCache.message_index)
    ).all()
    return [
        {
            "chatlog_id": r.chatlog_id,
            "message_index": r.message_index,
            "message_text": r.message_text,
            "context_before": r.context_before,
            "context_after": r.context_after,
        }
        for r in rows
    ]
