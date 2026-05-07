"""Queue logic for the single-label flow: pick the next conversation + message
that needs a decision for the active label."""
import logging
import hashlib
from typing import Optional

from sqlalchemy import text as sql_text
from sqlmodel import Session, select

from database import ext_engine
from models import LabelApplication, MessageCache

logger = logging.getLogger(__name__)


def _shuffle_key(label_id: int, chatlog_id: int) -> int:
    """Deterministic shuffle key: stable hash of (label_id, chatlog_id) → int.
    Each label gets its own walk order; the same label always walks the same way
    on resume, so progress is intuitive within a label even though different labels
    don't share a starting conversation."""
    digest = hashlib.blake2b(
        f"{label_id}:{chatlog_id}".encode(),
        digest_size=8,
    ).digest()
    return int.from_bytes(digest, "big", signed=False)


def next_message_for_label(
    session: Session,
    label_id: int,
    assignment_id: Optional[int] = None,
) -> Optional[dict]:
    """Return the next student-message that needs a decision for this label.

    Conversation-by-conversation walk: in-progress conversations first (ones with
    some decisions but not all), then not-started conversations by chatlog_id ascending.
    Within a conversation, walks message_index ascending.

    `assignment_id`: when provided, only conversations whose `MessageCache.assignment_id`
    matches are considered.

    Returns:
        {
          "chatlog_id", "message_index", "text", "notebook",
          "conversation_turn_count", "thread": [...all turns...], "focus_index": int
        } or None if there's nothing left to decide. The full conversation thread is
        returned so the UI can render every turn in chronological order with the focused
        turn highlighted in place.
    """
    cache_q = select(
        MessageCache.id,
        MessageCache.chatlog_id,
        MessageCache.message_index,
        MessageCache.message_text,
        MessageCache.notebook,
        MessageCache.assignment_id,
    )
    if assignment_id is not None:
        cache_q = cache_q.where(MessageCache.assignment_id == assignment_id)
    cache_rows = session.exec(cache_q).all()

    # All decisions already recorded for this label, keyed by (chatlog_id, message_index).
    decided = set(
        session.exec(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .where(LabelApplication.label_id == label_id)
        ).all()
    )

    # Per-conversation: list of student messages, and how many are decided.
    conv: dict[int, list[tuple[int, str, Optional[str]]]] = {}
    for _id, cid, midx, text, notebook, _assign in cache_rows:
        conv.setdefault(cid, []).append((midx, text, notebook))

    in_progress: list[int] = []
    not_started: list[int] = []
    for cid, msgs in conv.items():
        decided_in_conv = sum(1 for midx, _, _ in msgs if (cid, midx) in decided)
        if decided_in_conv == 0:
            not_started.append(cid)
        elif decided_in_conv < len(msgs):
            in_progress.append(cid)

    # In-progress conversations stay first (so the instructor finishes what they
    # started), but ordering among them, and especially among not-started ones,
    # uses a per-label deterministic shuffle so different labels don't all open at
    # chatlog #1 and feel like a loop.
    in_progress.sort(key=lambda c: _shuffle_key(label_id, c))
    not_started.sort(key=lambda c: _shuffle_key(label_id, c))

    for cid in in_progress + not_started:
        msgs = sorted(conv[cid], key=lambda t: t[0])
        for midx, text, notebook in msgs:
            if (cid, midx) in decided:
                continue
            return _build_focus_payload(session, label_id, cid, midx, text, notebook)

    return None


def _thread_from_message_cache(session: Session, chatlog_id: int) -> list[dict]:
    """Reconstruct tutor + student turns from SQLite MessageCache only.

    Each cached student row stores tutor snippets from ingest time:
    `context_before` = tutor reply immediately preceding this question,
    `context_after` = tutor reply immediately following this question.
    Interleave them in order and dedupe back-to-back identical tutor text
    (neighboring rows share the same boundary reply).
    """
    cached_rows = session.exec(
        select(
            MessageCache.message_index,
            MessageCache.message_text,
            MessageCache.context_before,
            MessageCache.context_after,
        )
        .where(MessageCache.chatlog_id == chatlog_id)
        .order_by(MessageCache.message_index)
    ).all()
    thread: list[dict] = []
    seq = 0

    def last_turn_meta():
        if not thread:
            return None, None
        last = thread[-1]
        return last["role"], last.get("text")

    def append_tutor(txt: str) -> None:
        nonlocal seq
        stripped = (txt or "").strip()
        if not stripped:
            return
        role, prev_text = last_turn_meta()
        if role == "tutor" and prev_text == stripped:
            return
        thread.append({"message_index": seq, "role": "tutor", "text": stripped})
        seq += 1

    def append_student(student_idx: int, txt: str) -> None:
        nonlocal seq
        thread.append({
            "message_index": seq,
            "role": "student",
            "text": txt,
            "student_index": student_idx,
        })
        seq += 1

    for midx, msg_text, ctx_before, ctx_after in cached_rows:
        append_tutor(ctx_before or "")
        append_student(midx, msg_text)
        append_tutor(ctx_after or "")

    return thread


def _student_focus_index(thread: list[dict], message_index: int) -> Optional[int]:
    return next(
        (
            i
            for i, t in enumerate(thread)
            if t["role"] == "student" and t.get("student_index") == message_index
        ),
        None,
    )


def _thread_has_tutor(thread: list[dict]) -> bool:
    return any(t.get("role") == "tutor" for t in thread)


def _build_focus_payload(
    session: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    text: str,
    notebook: Optional[str],
) -> dict:
    thread_pg = _fetch_full_thread(chatlog_id)
    focus_pg = _student_focus_index(thread_pg, message_index)

    # Only hit SQLite for rebuild when Postgres thread is missing, mismatched,
    # or student-only (tutor replies live in MessageCache.context_*).
    needs_cache = focus_pg is None or not _thread_has_tutor(thread_pg)
    thread_cache = (
        _thread_from_message_cache(session, chatlog_id) if needs_cache else []
    )
    focus_cache = (
        _student_focus_index(thread_cache, message_index) if thread_cache else None
    )

    if focus_pg is not None and _thread_has_tutor(thread_pg):
        thread, focus_index = thread_pg, focus_pg
    elif focus_cache is not None and _thread_has_tutor(thread_cache):
        thread, focus_index = thread_cache, focus_cache
    elif focus_pg is not None:
        thread, focus_index = thread_pg, focus_pg
    elif focus_cache is not None:
        thread, focus_index = thread_cache, focus_cache
    elif thread_cache:
        thread = thread_cache
        focus_index = focus_cache if focus_cache is not None else 0
    else:
        thread = [
            {"message_index": 0, "role": "student", "text": text, "student_index": message_index}
        ]
        focus_index = 0
    return {
        "chatlog_id": chatlog_id,
        "message_index": message_index,
        "text": text,
        "notebook": notebook,
        "conversation_turn_count": len(thread),
        "thread": [{"message_index": t["message_index"], "role": t["role"], "text": t["text"]}
                   for t in thread],
        "focus_index": focus_index,
    }


def _fetch_full_thread(chatlog_id: int) -> list[dict]:
    """Pull the entire conversation (every student question + tutor response) from
    the external Postgres events table, in chronological order. Each entry includes
    a `student_index` for student turns so we can locate the focused message."""
    sql = """
    WITH conv AS (
        SELECT id, event_type, payload, created_at
        FROM events
        WHERE event_type IN ('tutor_query', 'tutor_response')
          AND payload->>'conversation_id' = (
              SELECT payload->>'conversation_id'
              FROM events
              WHERE id = (
                  SELECT MIN(id)
                  FROM events
                  WHERE event_type IN ('tutor_query','tutor_response')
                    AND payload->>'conversation_id' IS NOT NULL
                  GROUP BY payload->>'conversation_id'
                  HAVING MIN(id) = :chatlog_id
              )
          )
        ORDER BY id ASC
    )
    SELECT event_type,
           payload->>'question' AS question,
           payload->>'response' AS response
    FROM conv
    """
    try:
        with ext_engine.connect() as conn:
            rows = conn.execute(sql_text(sql), {"chatlog_id": chatlog_id}).fetchall()
    except Exception as exc:
        logger.warning(
            "Failed to fetch full thread from external DB for chatlog_id=%s: %s",
            chatlog_id,
            exc,
        )
        return []  # external DB unreachable in tests / mock mode

    turns: list[dict] = []
    midx = 0
    student_idx = 0
    for et, q, r in rows:
        if et == "tutor_query" and q:
            turns.append({
                "message_index": midx,
                "role": "student",
                "text": q,
                "student_index": student_idx,
            })
            midx += 1
            student_idx += 1
        elif et == "tutor_response" and r:
            turns.append({"message_index": midx, "role": "tutor", "text": r})
            midx += 1
    return turns


