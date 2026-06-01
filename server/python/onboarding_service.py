"""Pick a high-quality starter conversation and suggested label names for onboarding."""
from __future__ import annotations

import json
import logging
import os
import re
import statistics
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import func
from sqlmodel import Session, select

import explore_service
import queue_service
from models import MessageCache, OnboardingStarterCache

logger = logging.getLogger(__name__)

_PREVIEW_TURNS = 3
_MIN_STUDENT_MSGS = 2
_MAX_STUDENT_MSGS = 10
_MAX_SPAM = 0.5
_MAX_PASTE_FIRST_TURNS = 0.7


def _score_pool_cap() -> int:
    try:
        return max(20, int(os.environ.get("CHATSIGHT_ONBOARDING_SCORE_CAP", "80")))
    except (TypeError, ValueError):
        return 80


def _dedupe_names(names: list[str], limit: int = 3) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        key = n.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(n.strip())
        if len(out) >= limit:
            break
    return out


def rule_based_label_suggestions(text: str) -> list[str]:
    """Short label-name ideas (2–4 words), deterministic fallback."""
    t = (text or "").strip()
    if not t:
        return ["Misc student message"]

    paste = explore_service.student_message_copy_paste_likelihood(t)
    spec = explore_service.student_help_specificity(t)
    generic = explore_service.student_help_genericness(t)
    lower = t.lower()
    names: list[str] = []

    if paste >= 0.65:
        names.extend(["Copy-paste", "Pasted assignment"])
    elif paste >= 0.4:
        names.append("Mostly pasted text")

    if "traceback" in lower or ("error" in lower and len(t) > 80):
        names.append("Debugging help")

    if spec >= 0.55:
        if any(
            s in lower
            for s in ("how do", "why does", "what is", "explain", "logic behind", "confused")
        ):
            names.extend(["Concept question", "Homework logic"])
        else:
            names.append("Specific ask")

    if any(s in lower for s in ("answer", "solve for me", "write the code", "do this for")):
        names.append("Answer request")

    if generic >= 0.75 or (len(t) < 35 and spec < 0.45):
        names.extend(["Generic help", "Vague question"])

    return _dedupe_names(names) or ["Student question"]


def _ai_label_suggestions_for_turns(turns: list[tuple[int, str]]) -> Optional[dict[int, list[str]]]:
    """Gemini: 2–3 short label names per student message. None if unavailable."""
    if not explore_service._gemini_available():
        return None
    try:
        blocks = []
        for i, (_midx, text) in enumerate(turns, 1):
            snippet = (text or "").strip()
            if len(snippet) > 500:
                snippet = snippet[:500] + "…"
            blocks.append(f"Message {i}:\n{snippet}")
        prompt = (
            "An instructor will create LABEL NAMES (2–5 words each) for student tutoring messages.\n"
            "For each message below, suggest 2–3 distinct label names they might use — "
            "like category titles, NOT full sentences. Examples: Copy-paste, Concept question, "
            "Answer request, Debugging help, Generic help.\n\n"
            + "\n\n".join(blocks)
            + '\n\nRespond with ONLY valid JSON: {"suggestions": [["name1","name2"], ...]} '
            "one inner array per message in order."
        )
        response = explore_service._client_get().models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        raw = ""
        for part in response.candidates[0].content.parts:
            if getattr(part, "text", None):
                raw += part.text
        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            return None
        data = json.loads(match.group())
        rows = data.get("suggestions") or data.get("labels")
        if not isinstance(rows, list) or len(rows) != len(turns):
            return None
        out: dict[int, list[str]] = {}
        for (midx, _text), row in zip(turns, rows):
            if not isinstance(row, list):
                continue
            names = _dedupe_names([str(x) for x in row if x])
            if names:
                out[midx] = names
        return out if out else None
    except Exception:
        logger.exception("onboarding AI label suggestions failed")
        return None


def build_suggested_label_names(
    preview_msgs: list[MessageCache],
) -> tuple[dict[int, list[str]], str]:
    turns = [(m.message_index, m.message_text or "") for m in preview_msgs]
    ai = _ai_label_suggestions_for_turns(turns)
    used_ai = bool(ai)
    out: dict[int, list[str]] = {}
    for midx, text in turns:
        names = (ai or {}).get(midx) or rule_based_label_suggestions(text)
        out[midx] = names
    return out, ("ai" if used_ai else "rules")


def _message_cache_count(session: Session) -> int:
    return int(session.exec(select(func.count()).select_from(MessageCache)).one())


def _load_conversations(session: Session) -> dict[int, list[MessageCache]]:
    rows = session.exec(
        select(MessageCache).order_by(MessageCache.chatlog_id, MessageCache.message_index)
    ).all()
    by_conv: dict[int, list[MessageCache]] = {}
    for row in rows:
        by_conv.setdefault(row.chatlog_id, []).append(row)
    return by_conv


def _pick_seed_message_index(msgs: list[MessageCache]) -> int:
    for m in sorted(msgs, key=lambda x: x.message_index):
        text = m.message_text or ""
        if explore_service.student_message_copy_paste_likelihood(text) < _MAX_PASTE_FIRST_TURNS:
            return m.message_index
    return msgs[0].message_index


def _passes_hard_filters(msgs: list[MessageCache]) -> bool:
    texts = [m.message_text or "" for m in msgs]
    if explore_service.conversation_spam_penalty(texts) > _MAX_SPAM:
        return False
    n = len(msgs)
    if n < _MIN_STUDENT_MSGS or n > _MAX_STUDENT_MSGS:
        return False
    preview = msgs[:_PREVIEW_TURNS]
    return not any(
        explore_service.student_message_copy_paste_likelihood(m.message_text or "")
        >= _MAX_PASTE_FIRST_TURNS
        for m in preview
    )


def _fast_priority(
    session: Session, chatlog_id: int, msgs: list[MessageCache]
) -> float:
    """Cheap score for shortlisting (matches explore shortlist — no corpus rarity)."""
    if not _passes_hard_filters(msgs):
        return -1.0
    texts = [m.message_text or "" for m in msgs]
    first = msgs[0]
    return explore_service.explore_candidate_priority(
        session,
        chatlog_id,
        first.message_text or "",
        first.message_index,
        texts,
        use_corpus_rarity=False,
    )


def _refined_score(msgs: list[MessageCache], fast_priority: float) -> float:
    """Full onboarding score on a shortlist only — still no embedding matrix walks."""
    texts = [m.message_text or "" for m in msgs]
    spam = explore_service.conversation_spam_penalty(texts)
    specs = [
        explore_service.student_help_specificity(m.message_text or "")
        for m in msgs
    ]
    n = len(msgs)
    contrast = 0.15 if max(specs) >= 0.55 and min(specs) <= 0.45 else 0.0
    length_bonus = 0.06 if 3 <= n <= 7 else (0.02 if n == 2 else 0.0)
    spread_bonus = 0.08 * min(1.0, statistics.pstdev(specs)) if n > 1 else 0.0
    return fast_priority * (1.0 - spam) + contrast + length_bonus + spread_bonus


def _pick_best_chatlog(
    session: Session,
    by_conv: dict[int, list[MessageCache]],
    *,
    exclude_chatlog_ids: Optional[frozenset[int]] = None,
) -> Optional[int]:
    """Two-phase pick: fast filter all convs, refine top cap only (like explore queue)."""
    fast: list[tuple[float, int]] = []
    for cid, msgs in by_conv.items():
        if exclude_chatlog_ids and cid in exclude_chatlog_ids:
            continue
        pri = _fast_priority(session, cid, msgs)
        if pri >= 0:
            fast.append((pri, cid))
    if not fast:
        return None

    fast.sort(key=lambda x: (-x[0], x[1]))
    cap = _score_pool_cap()
    shortlist = fast[:cap]

    scored: list[tuple[float, int]] = []
    fast_by_cid = {cid: pri for pri, cid in shortlist}
    for pri, cid in shortlist:
        refined = _refined_score(by_conv[cid], pri)
        if refined >= 0:
            scored.append((refined, cid))
    if not scored:
        return shortlist[0][1]

    scored.sort(key=lambda x: (-x[0], x[1]))
    top_score = scored[0][0]
    threshold = top_score * 0.95
    top_band = [cid for s, cid in scored if s >= threshold]
    return min(top_band)


def _cache_valid(session: Session, cache: OnboardingStarterCache) -> bool:
    return cache.message_cache_count == _message_cache_count(session)


def pick_starter_conversation(
    session: Session,
    *,
    force_refresh: bool = False,
    exclude_chatlog_id: Optional[int] = None,
) -> Optional[dict]:
    """Return starter payload dict; uses cached pick when corpus size unchanged."""
    count = _message_cache_count(session)
    if count == 0:
        return None

    cache = session.get(OnboardingStarterCache, 1)
    use_cache = (
        cache
        and not force_refresh
        and exclude_chatlog_id is None
        and _cache_valid(session, cache)
    )
    if use_cache:
        names, source = _load_suggestions_json(cache.preview_json)
        return _build_payload(session, cache.chatlog_id, cache.seed_message_index, names, source)

    by_conv = _load_conversations(session)
    exclude = frozenset({exclude_chatlog_id}) if exclude_chatlog_id is not None else None
    cid = _pick_best_chatlog(session, by_conv, exclude_chatlog_ids=exclude)
    if cid is None and exclude:
        cid = _pick_best_chatlog(session, by_conv)
    if cid is None:
        return None

    msgs = by_conv[cid]
    seed_midx = _pick_seed_message_index(msgs)

    preview = msgs[:_PREVIEW_TURNS]
    suggestions, suggestions_source = build_suggested_label_names(preview)
    suggestions_json = json.dumps(
        {"names": {str(k): v for k, v in suggestions.items()}, "source": suggestions_source}
    )

    if cache:
        cache.chatlog_id = cid
        cache.seed_message_index = seed_midx
        cache.message_cache_count = count
        cache.preview_json = suggestions_json
        cache.computed_at = datetime.utcnow()
        session.add(cache)
    else:
        session.add(
            OnboardingStarterCache(
                id=1,
                chatlog_id=cid,
                seed_message_index=seed_midx,
                message_cache_count=count,
                preview_json=suggestions_json,
                computed_at=datetime.utcnow(),
            )
        )
    session.commit()
    return _build_payload(session, cid, seed_midx, suggestions, suggestions_source)


def _load_suggestions_json(raw: Optional[str]) -> tuple[dict[int, list[str]], str]:
    if not raw:
        return {}, "rules"
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and "names" in data:
            names = {int(k): list(v) for k, v in data["names"].items()}
            source = str(data.get("source") or "rules")
            return names, source
        return {int(k): list(v) for k, v in data.items()}, "rules"
    except (json.JSONDecodeError, TypeError, ValueError):
        return {}, "rules"


def starter_payload_for_chatlog(
    session: Session,
    chatlog_id: int,
    message_index: int,
) -> dict[str, Any]:
    """Minimal starter dict for focusing a specific message in an existing chatlog."""
    row = session.exec(
        select(MessageCache).where(
            MessageCache.chatlog_id == chatlog_id,
            MessageCache.message_index == message_index,
        )
    ).first()
    if not row:
        raise ValueError("Message not found in cache")
    count = session.exec(
        select(func.count(MessageCache.id)).where(MessageCache.chatlog_id == chatlog_id)
    ).one()
    cache = session.get(OnboardingStarterCache, 1)
    suggestions, suggestions_source = _load_suggestions_json(
        cache.preview_json if cache else None
    )
    msgs = session.exec(
        select(MessageCache)
        .where(MessageCache.chatlog_id == chatlog_id)
        .order_by(MessageCache.message_index)
    ).all()
    preview = msgs[:_PREVIEW_TURNS]
    if not suggestions and preview:
        suggestions, suggestions_source = build_suggested_label_names(preview)
    notebook = next((m.notebook for m in msgs if m.notebook), None)
    return {
        "chatlog_id": chatlog_id,
        "seed_message_index": message_index,
        "notebook": notebook,
        "conversation_student_messages": int(count),
        "suggestions_source": suggestions_source,
        "preview_turns": [
            {
                "message_index": m.message_index,
                "message_text": m.message_text,
                "suggested_label_names": suggestions.get(m.message_index)
                or rule_based_label_suggestions(m.message_text or ""),
            }
            for m in preview
        ],
    }


def starter_focused_message(
    session: Session,
    starter: dict[str, Any],
    message_index: Optional[int] = None,
) -> dict[str, Any]:
    """Full thread + focus for the starter conversation (no label required)."""
    chatlog_id = int(starter["chatlog_id"])
    message_index = int(
        message_index if message_index is not None else starter["seed_message_index"]
    )
    row = session.exec(
        select(MessageCache).where(
            MessageCache.chatlog_id == chatlog_id,
            MessageCache.message_index == message_index,
        )
    ).first()
    if not row:
        raise ValueError("Starter message not found in cache")
    student_count = int(starter.get("conversation_student_messages") or 1)
    meta = queue_service.build_sampling_meta(
        session,
        0,
        chatlog_id,
        message_index,
        student_count,
        "explore",
    )
    return queue_service._build_focus_payload(
        session,
        0,
        chatlog_id,
        message_index,
        row.message_text,
        row.notebook,
        sampling_meta=meta,
    )


def _browse_after_conversation_exhausted(
    session: Session,
    exhausted_chatlog_ids: list[int],
) -> dict[str, Any]:
    focused_payload = queue_service.next_message_for_onboarding_browse(
        session, exhausted_chatlog_ids
    )
    if focused_payload is None:
        payload = pick_starter_conversation(session, force_refresh=True)
        if not payload:
            raise ValueError("No starter conversations available")
        focused_payload = starter_focused_message(session, payload)
        return {
            "starter": payload,
            "focused": focused_payload,
            "browse_reset": True,
        }
    return {
        "focused": focused_payload,
        "exhausted_chatlog_ids": exhausted_chatlog_ids,
    }


def next_starter_browse_message(
    session: Session,
    chatlog_id: int,
    message_index: int,
    exhausted_chatlog_ids: Optional[list[int]] = None,
    *,
    skip_conversation: bool = False,
) -> dict[str, Any]:
    """Advance to the next student message in the same conversation (pre-label browse)."""
    if skip_conversation:
        exhausted = list({*(exhausted_chatlog_ids or []), chatlog_id})
        return _browse_after_conversation_exhausted(session, exhausted)

    indices = list(
        session.exec(
            select(MessageCache.message_index)
            .where(MessageCache.chatlog_id == chatlog_id)
            .order_by(MessageCache.message_index)
        ).all()
    )
    if not indices:
        raise ValueError("No messages in conversation")
    next_index = next((i for i in indices if i > message_index), None)
    if next_index is None:
        exhausted = list({*(exhausted_chatlog_ids or []), chatlog_id})
        return _browse_after_conversation_exhausted(session, exhausted)
    starter = starter_payload_for_chatlog(session, chatlog_id, next_index)
    focused = starter_focused_message(session, starter, message_index=next_index)
    return {"starter": starter, "focused": focused}


def _build_payload(
    session: Session,
    chatlog_id: int,
    seed_message_index: int,
    suggestions: Optional[dict[int, list[str]]] = None,
    suggestions_source: str = "rules",
) -> dict[str, Any]:
    msgs = session.exec(
        select(MessageCache)
        .where(MessageCache.chatlog_id == chatlog_id)
        .order_by(MessageCache.message_index)
    ).all()
    preview = msgs[:_PREVIEW_TURNS]
    notebook = next((m.notebook for m in msgs if m.notebook), None)

    if suggestions is None:
        cache = session.get(OnboardingStarterCache, 1)
        suggestions, suggestions_source = _load_suggestions_json(
            cache.preview_json if cache else None
        )
        if not suggestions and preview:
            suggestions, suggestions_source = build_suggested_label_names(preview)

    return {
        "chatlog_id": chatlog_id,
        "seed_message_index": seed_message_index,
        "notebook": notebook,
        "conversation_student_messages": len(msgs),
        "suggestions_source": suggestions_source,
        "preview_turns": [
            {
                "message_index": m.message_index,
                "message_text": m.message_text,
                "suggested_label_names": suggestions.get(m.message_index)
                or rule_based_label_suggestions(m.message_text or ""),
            }
            for m in preview
        ],
        "score_summary": None,
    }
