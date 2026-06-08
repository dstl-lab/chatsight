"""Queue logic for the single-label flow: pick the next conversation + message
that needs a decision for the active label."""
import hashlib
import json
import logging
import math
import os
import random
import threading
from collections import OrderedDict
from typing import Iterable, Optional, Tuple

from sqlalchemy import text as sql_text
from sqlmodel import Session, select

import assist_service
import explore_service
import study_scope
from database import ext_engine
from models import (
    ConversationCursor,
    ConversationProfile,
    LabelApplication,
    LabelDefinition,
    MessageCache,
)

logger = logging.getLogger(__name__)

# Virtual label id for pre-label /run browse: uses hybrid sampling without DB rows.
ONBOARDING_BROWSE_LABEL_ID = 0

# Conversation threads in `events` are immutable once ingested, so a per-process
# cache keyed by chatlog_id removes redundant Postgres roundtrips during /run
# (the instructor stays in one conversation across several decide clicks).
_THREAD_CACHE_MAX = 512
_thread_cache: "OrderedDict[int, list[dict]]" = OrderedDict()
_thread_cache_lock = threading.Lock()


def _clear_thread_cache() -> None:
    """Test hook: drop all cached threads."""
    with _thread_cache_lock:
        _thread_cache.clear()


def neighbor_uncertainty_novelty(
    session: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
) -> Optional[Tuple[float, float]]:
    """From live embedding k-NN (same source as /assist), return (uncertainty, novelty) in [0,1]."""
    neighbors = assist_service.nearest_neighbors(
        session, label_id, chatlog_id, message_index, k=5
    )
    if not neighbors:
        return None

    yes_sum = 0.0
    no_sum = 0.0
    max_sim = None
    for n in neighbors:
        sim = float(n.get("similarity", 0.0))
        max_sim = sim if max_sim is None else max(max_sim, sim)
        v = n.get("value")
        if v == "yes":
            yes_sum += max(sim, 0.0)
        elif v == "no":
            no_sum += max(sim, 0.0)

    denom = yes_sum + no_sum
    if denom <= 0.0:
        return None

    p_yes = yes_sum / denom
    eps = 1e-12
    p_yes = max(eps, min(1.0 - eps, p_yes))
    entropy = -p_yes * math.log(p_yes) - (1.0 - p_yes) * math.log(1.0 - p_yes)
    uncertainty = entropy / math.log(2.0)

    max_sim = float(max_sim if max_sim is not None else 0.0)
    max_sim = max(0.0, min(1.0, max_sim))
    novelty = 1.0 - max_sim
    return uncertainty, novelty


def _truncate_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text.strip()
    return " ".join(words[:max_words]).strip()


def _score_tier(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    if value >= 0.55:
        return "high"
    if value >= 0.35:
        return "med"
    return "low"


def compose_explore_pick_explanation(
    session: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    pending_text: str,
    *,
    precomputed: Optional[dict] = None,
) -> dict:
    """≤20-word summary + concise score bullets for Explore (frozen per chat).

    Pass `precomputed` (from `_select_next_chatlog_id`) to skip re-running the
    expensive k-NN and embedding queries for the winning candidate."""
    if precomputed:
        unc_nov = precomputed.get("unc_nov")
        conv_nov = precomputed.get("conv_nov")
        theme_nov = precomputed.get("theme_nov")
        rarity = precomputed.get("rarity")
        spec = precomputed.get("spec")
    else:
        unc_nov = neighbor_uncertainty_novelty(session, label_id, chatlog_id, message_index)
        labeled_centroids = explore_service.labeled_student_centroids(session, label_id)
        conv_nov = explore_service.conversation_novelty(
            session, label_id, chatlog_id, labeled_centroids
        )
        theme_nov = explore_service.theme_novelty(session, label_id, chatlog_id)
        rarity = explore_service.student_message_corpus_rarity(session, chatlog_id, message_index)
        spec = explore_service.student_help_specificity(
            pending_text or "", corpus_rarity=rarity
        )
    paste_score = explore_service.student_message_copy_paste_likelihood(pending_text or "")
    if spec is None:
        spec = explore_service.student_help_specificity(
            pending_text or "", corpus_rarity=rarity
        )
    paste = paste_score or 0.0

    breakdown: list[str] = []
    if spec is not None:
        breakdown.append(f"Specificity · {_score_tier(spec)}")
    if rarity is not None:
        breakdown.append(f"Rare wording · {_score_tier(rarity)}")
    if conv_nov is not None:
        breakdown.append(f"Conv novelty · {_score_tier(conv_nov)}")
    if theme_nov is not None:
        breakdown.append(f"Theme novelty · {_score_tier(theme_nov)}")
    if unc_nov:
        unc, nov = unc_nov
        if nov is not None:
            breakdown.append(f"Msg novelty · {_score_tier(nov)}")
        if unc is not None:
            breakdown.append(f"Ambiguity · {_score_tier(unc)}")
    if paste >= 0.65:
        breakdown.append("Paste risk · high")

    strong: list[str] = []
    if spec is not None and spec >= 0.55 and paste < 0.65:
        strong.append("specificity")
    if rarity is not None and rarity >= 0.5 and paste < 0.65:
        strong.append("rare wording")
    if conv_nov is not None and conv_nov >= 0.5:
        strong.append("new topics")
    if theme_nov is not None and theme_nov >= 0.5:
        strong.append("new theme")
    if unc_nov and unc_nov[0] is not None and unc_nov[0] >= 0.55 and paste < 0.65:
        strong.append("neighbor ambiguity")

    if strong:
        summary = _truncate_words(f"Strong {', '.join(strong[:3])}.", 20)
    else:
        summary = _truncate_words("Varied student help; worth labeling next.", 20)

    return {"summary": summary, "breakdown": breakdown}


def compose_explore_pick_summary(
    session: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    pending_text: str,
) -> str:
    return compose_explore_pick_explanation(
        session, label_id, chatlog_id, message_index, pending_text
    )["summary"]


def _ensure_explore_pick_explanation(
    session: Session,
    label_id: int,
    chatlog_id: int,
    summary: str,
    breakdown: list[str],
) -> None:
    """Store pick explanation once per (label, chat); reused for every message in the chat."""
    row = session.get(ConversationCursor, (label_id, chatlog_id))
    if row and row.explore_pick_summary:
        return
    payload = json.dumps(breakdown)
    if row:
        row.explore_pick_summary = summary
        row.explore_pick_breakdown = payload
        session.add(row)
        return
    session.add(
        ConversationCursor(
            label_id=label_id,
            chatlog_id=chatlog_id,
            last_message_index=0,
            last_message_index_decided=0,
            explore_pick_summary=summary,
            explore_pick_breakdown=payload,
        )
    )


def _ensure_explore_pick_summary(
    session: Session,
    label_id: int,
    chatlog_id: int,
    summary: str,
) -> None:
    _ensure_explore_pick_explanation(session, label_id, chatlog_id, summary, [])


def _last_human_labeled_chatlog_id(session: Session, label_id: int) -> Optional[int]:
    row = session.exec(
        select(LabelApplication.chatlog_id)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
        )
        .order_by(LabelApplication.created_at.desc(), LabelApplication.id.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    return row[0] if isinstance(row, tuple) else row


def _display_sampling_pick(
    session: Session,
    label_id: int,
    chatlog_id: int,
    pick_mode: str,
) -> str:
    """UI-facing pick mode.

    Internal selection uses ``continue`` for any in-progress chat. Instructors
    should only see Continue when resuming a *different* chat they left partial;
    walking message 2+ in an Explore-opened chat stays Explore.
    """
    if pick_mode == "baseline":
        pick_mode = "round_robin"
    if pick_mode != "continue":
        return pick_mode

    cursor = session.get(ConversationCursor, (label_id, chatlog_id))
    if not cursor or not (cursor.explore_pick_summary or "").strip():
        return pick_mode

    # Still walking this Explore-opened chat (yes/no/skip on msg 1, 2, …).
    if _last_human_labeled_chatlog_id(session, label_id) == chatlog_id:
        return "explore"
    # Came back after labeling a different conversation.
    return pick_mode


def build_sampling_meta(
    session: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    conversation_student_messages: int,
    sampling_pick: str,
) -> dict:
    """Queue context for the RUN meta bar (no per-message metric chips)."""
    if sampling_pick == "baseline":
        sampling_pick = "round_robin"

    cursor = session.get(ConversationCursor, (label_id, chatlog_id))
    explore_pick_summary = (
        cursor.explore_pick_summary.strip()
        if cursor and cursor.explore_pick_summary and cursor.explore_pick_summary.strip()
        else None
    )
    explore_pick_breakdown: Optional[list[str]] = None
    if cursor and cursor.explore_pick_breakdown:
        try:
            parsed = json.loads(cursor.explore_pick_breakdown)
            if isinstance(parsed, list):
                explore_pick_breakdown = [str(x) for x in parsed]
        except (json.JSONDecodeError, TypeError):
            explore_pick_breakdown = None

    return {
        "sampling_pick": sampling_pick,
        "conversation_student_messages": conversation_student_messages,
        "pending_student_message_number": message_index + 1,
        "explore_pick_summary": explore_pick_summary,
        "explore_pick_breakdown": explore_pick_breakdown,
        "neighbor_scores_available": False,
        "neighbor_uncertainty_pct": None,
        "neighbor_novelty_pct": None,
        "conversation_novelty_pct": None,
        "theme_novelty_pct": None,
        "student_specificity_pct": None,
        "student_rarity_pct": None,
        "conversation_summary": None,
        "pick_rationale": None,
        "sampling_hint": None,
    }


def default_hybrid_explore_fraction() -> float:
    """Server default when `LabelDefinition.hybrid_explore_fraction` is unset."""
    try:
        v = float(os.environ.get("CHATSIGHT_HYBRID_EXPLORE_FRACTION", "0.75"))
    except (TypeError, ValueError):
        v = 0.75
    return max(0.0, min(1.0, v))


def _shuffle_key(label_id: int, chatlog_id: int) -> int:
    digest = hashlib.blake2b(
        f"{label_id}:{chatlog_id}".encode(),
        digest_size=8,
    ).digest()
    return int.from_bytes(digest, "big", signed=False)


def _first_pending_turn(
    cid: int,
    msgs: list[tuple[int, str, Optional[str]]],
    decided: set,
) -> Optional[tuple[int, str, Optional[str]]]:
    for midx, text, notebook in sorted(msgs, key=lambda t: t[0]):
        if (cid, midx) not in decided:
            return midx, text, notebook
    return None


def _select_next_chatlog_id(
    session: Session,
    label_id: int,
    conv: dict[int, list[tuple[int, str, Optional[str]]]],
    assign_by_cid: dict[int, Optional[int]],
    decided: set,
    in_progress: list[int],
    not_started: list[int],
    explore_fraction: float,
) -> Tuple[Optional[int], Optional[str], Optional[dict]]:
    ip_pending = [
        c for c in in_progress
        if c in conv and _first_pending_turn(c, conv[c], decided)
    ]
    ns_pending = [
        c for c in not_started
        if c in conv and _first_pending_turn(c, conv[c], decided)
    ]
    if not ip_pending and not ns_pending:
        return None, None, None

    pool = ip_pending if ip_pending else ns_pending
    in_prog_bucket = bool(ip_pending)

    if len(pool) == 1:
        if in_prog_bucket:
            return pool[0], "continue", None
        return pool[0], "round_robin", None

    explore = random.random() < explore_fraction
    if not explore:
        if in_prog_bucket:
            pool_sorted = sorted(pool, key=lambda c: _shuffle_key(label_id, c))
            return pool_sorted[0], "continue", None
        pool_sorted = sorted(
            pool,
            key=lambda c: (
                assign_by_cid.get(c) is None,
                assign_by_cid.get(c) if assign_by_cid.get(c) is not None else -1,
                _shuffle_key(label_id, c),
            ),
        )
        return pool_sorted[0], "round_robin", None

    cap = explore_service.explore_score_pool_cap()
    pool_to_score = pool
    if len(pool) > cap:
        rng = random.Random(_shuffle_key(label_id, 0) ^ len(pool))
        pool_to_score = rng.sample(pool, cap)

    def _shortlist_key(cid: int) -> tuple[float, int]:
        pending = _first_pending_turn(cid, conv[cid], decided)
        if not pending:
            return (0.0, cid)
        midx, text, _nb = pending
        texts = [t for _i, t, _n in conv[cid]]
        pri = explore_service.explore_candidate_priority(
            session, cid, text, midx, texts, use_corpus_rarity=False
        )
        return (pri, cid)

    explore_candidates = sorted(pool_to_score, key=lambda c: (-_shortlist_key(c)[0], c))[
        : max(1, (len(pool_to_score) + 3) // 4)
    ]

    notebooks: dict[int, Optional[str]] = {}
    for cid in explore_candidates:
        for _midx, _text, notebook in conv.get(cid, []):
            if notebook is not None:
                notebooks[cid] = notebook
                break
        else:
            notebooks[cid] = None
    explore_service.warm_explore_candidates(
        label_id,
        explore_candidates,
        conv,
        notebooks,
    )

    labeled_centroids = explore_service.labeled_student_centroids(session, label_id)
    theme_vectors = explore_service.labeled_theme_vectors(session, label_id)

    def _conversation_utility(cid: int) -> Tuple[float, dict]:
        pending = _first_pending_turn(cid, conv[cid], decided)
        if not pending:
            return 0.0, {}
        midx, text, _notebook = pending
        student_texts = [t for _i, t, _n in conv[cid]]
        unc_nov = neighbor_uncertainty_novelty(session, label_id, cid, midx)
        uncertainty, msg_nov = (unc_nov if unc_nov else (None, None))
        conv_nov = explore_service.conversation_novelty(
            session, label_id, cid, labeled_centroids
        )
        theme_nov = explore_service.theme_novelty(
            session, label_id, cid, theme_vectors
        )
        rarity = explore_service.student_message_corpus_rarity(session, cid, midx)
        spec = explore_service.student_help_specificity(text, corpus_rarity=rarity)
        spam = explore_service.conversation_spam_penalty(student_texts)
        score = explore_service.blended_explore_utility(
            uncertainty,
            msg_nov,
            conv_nov,
            theme_nov,
            spec,
            rarity,
            spam,
        )
        components = {
            "unc_nov": unc_nov,
            "conv_nov": conv_nov,
            "theme_nov": theme_nov,
            "rarity": rarity,
            "spec": spec,
        }
        return score, components

    utility_results = {
        cid: _conversation_utility(cid) for cid in explore_candidates
    }
    utility_scores = {cid: score for cid, (score, _) in utility_results.items()}
    scored = sorted(
        explore_candidates,
        key=lambda c: (-utility_scores[c], c),
    )
    top_k = max(1, (len(scored) + 3) // 4)
    explore_choices = [c for c in scored[:top_k]]

    winner = random.choice(explore_choices)
    _, winner_components = utility_results[winner]
    return winner, "explore", winner_components


def _synthetic_decided_for_exhausted_conversations(
    session: Session, chatlog_ids: Iterable[int]
) -> set[tuple[int, int]]:
    """Treat every student turn in these conversations as already visited (browse-only)."""
    decided: set[tuple[int, int]] = set()
    for cid in set(chatlog_ids):
        for midx in session.exec(
            select(MessageCache.message_index).where(MessageCache.chatlog_id == cid)
        ).all():
            decided.add((cid, midx))
    return decided


def next_message_for_onboarding_browse(
    session: Session,
    exhausted_chatlog_ids: list[int],
    assignment_id: Optional[int] = None,
    explore_fraction: Optional[float] = None,
) -> Optional[dict]:
    """After walking off the end of a conversation, pick the next message like labeled skip."""
    extra = _synthetic_decided_for_exhausted_conversations(session, exhausted_chatlog_ids)
    return next_message_for_label(
        session,
        ONBOARDING_BROWSE_LABEL_ID,
        assignment_id=assignment_id,
        explore_fraction=explore_fraction,
        extra_decided=extra,
    )


def next_message_for_label(
    session: Session,
    label_id: int,
    assignment_id: Optional[int] = None,
    explore_fraction: Optional[float] = None,
    *,
    extra_decided: Optional[set[tuple[int, int]]] = None,
    hint_chatlog_id: Optional[int] = None,
) -> Optional[dict]:
    eff_explore = (
        max(0.0, min(1.0, explore_fraction))
        if explore_fraction is not None
        else default_hybrid_explore_fraction()
    )

    # Fast path: a brand-new label with an onboarding seed and no decisions yet
    # can return immediately without scanning the full MessageCache.
    label = session.get(LabelDefinition, label_id)
    decided = set(
        session.exec(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .where(LabelApplication.label_id == label_id)
        ).all()
    )
    if extra_decided:
        decided |= extra_decided

    if (
        label
        and label.onboarding_seed_chatlog_id is not None
        and len(decided) == 0
    ):
        seed_cid = label.onboarding_seed_chatlog_id
        seed_midx = label.onboarding_seed_message_index or 0
        seed_row = session.exec(
            select(
                MessageCache.message_text,
                MessageCache.notebook,
            )
            .where(MessageCache.chatlog_id == seed_cid)
            .where(MessageCache.message_index == seed_midx)
        ).first()
        if seed_row:
            text, notebook = seed_row
            sampling_meta = build_sampling_meta(
                session,
                label_id,
                seed_cid,
                seed_midx,
                len(
                    session.exec(
                        select(MessageCache.message_index).where(
                            MessageCache.chatlog_id == seed_cid
                        )
                    ).all()
                ),
                "round_robin",
            )
            return _build_focus_payload(
                session,
                label_id,
                seed_cid,
                seed_midx,
                text,
                notebook,
                sampling_meta=sampling_meta,
            )

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

    # Study lock: restrict to the week tied to this label's mode
    # (single -> Week 8, multi/onboarding -> Week 3). Unconditional; the
    # client assignment_id filter above only narrows further.
    _scope = study_scope.scope_for_mode(label.mode if label else "multi")
    cache_rows = [
        row for row in cache_rows
        if study_scope.notebook_in_scope(row[4], _scope)
    ]

    conv: dict[int, list[tuple[int, str, Optional[str]]]] = {}
    assign_by_cid: dict[int, Optional[int]] = {}
    for _id, cid, midx, text, notebook, assign in cache_rows:
        conv.setdefault(cid, []).append((midx, text, notebook))
        if cid not in assign_by_cid:
            assign_by_cid[cid] = assign

    in_progress: list[int] = []
    not_started: list[int] = []
    for cid, msgs in conv.items():
        decided_in_conv = sum(1 for midx, _, _ in msgs if (cid, midx) in decided)
        if decided_in_conv == 0:
            not_started.append(cid)
        elif decided_in_conv < len(msgs):
            in_progress.append(cid)

    in_progress.sort(key=lambda c: _shuffle_key(label_id, c))
    not_started.sort(key=lambda c: _shuffle_key(label_id, c))

    # If the caller pinned a conversation (e.g. after a label switch), try it first.
    if hint_chatlog_id is not None and hint_chatlog_id in conv:
        tup = _first_pending_turn(hint_chatlog_id, conv[hint_chatlog_id], decided)
        if tup:
            midx, text, notebook = tup
            sampling_meta = build_sampling_meta(
                session, label_id, hint_chatlog_id, midx,
                len(conv[hint_chatlog_id]), "round_robin",
            )
            return _build_focus_payload(
                session, label_id, hint_chatlog_id, midx, text, notebook,
                sampling_meta=sampling_meta,
            )
        # Hint conversation is fully decided for this label — fall through to normal pick.

    cid_pick, pick_mode, pick_components = _select_next_chatlog_id(
        session,
        label_id,
        conv,
        assign_by_cid,
        decided,
        in_progress,
        not_started,
        eff_explore,
    )
    if cid_pick is None or pick_mode is None:
        return None

    tup = _first_pending_turn(cid_pick, conv[cid_pick], decided)
    if not tup:
        return None
    midx, text, notebook = tup
    if pick_mode == "explore":
        explanation = compose_explore_pick_explanation(
            session, label_id, cid_pick, midx, text, precomputed=pick_components
        )
        _ensure_explore_pick_explanation(
            session,
            label_id,
            cid_pick,
            explanation["summary"],
            explanation["breakdown"],
        )
    display_pick = _display_sampling_pick(session, label_id, cid_pick, pick_mode)
    sampling_meta = build_sampling_meta(
        session,
        label_id,
        cid_pick,
        midx,
        len(conv[cid_pick]),
        display_pick,
    )
    return _build_focus_payload(
        session, label_id, cid_pick, midx, text, notebook, sampling_meta=sampling_meta
    )


def _thread_from_message_cache(session: Session, chatlog_id: int) -> list[dict]:
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
        # context_before on message 0 is often a pre-conversation tutor event — skip it.
        if midx > 0:
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
    sampling_meta: Optional[dict] = None,
) -> dict:
    thread_pg = _fetch_full_thread(chatlog_id)
    focus_pg = _student_focus_index(thread_pg, message_index)

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
    out = {
        "chatlog_id": chatlog_id,
        "message_index": message_index,
        "text": text,
        "notebook": notebook,
        "conversation_turn_count": len(thread),
        "thread": [{"message_index": t["message_index"], "role": t["role"], "text": t["text"]}
                   for t in thread],
        "focus_index": focus_index,
        "sampling_pick": None,
        "conversation_student_messages": None,
        "pending_student_message_number": None,
        "neighbor_scores_available": False,
        "neighbor_uncertainty_pct": None,
        "neighbor_novelty_pct": None,
        "conversation_novelty_pct": None,
        "theme_novelty_pct": None,
        "student_specificity_pct": None,
        "student_rarity_pct": None,
        "conversation_summary": None,
        "explore_pick_summary": None,
        "explore_pick_breakdown": None,
        "pick_rationale": None,
        "sampling_hint": None,
    }
    if sampling_meta:
        out.update(sampling_meta)
    return out


def _fetch_full_thread(chatlog_id: int) -> list[dict]:
    with _thread_cache_lock:
        cached = _thread_cache.get(chatlog_id)
        if cached is not None:
            _thread_cache.move_to_end(chatlog_id)
            return cached

    result = _fetch_full_thread_uncached(chatlog_id)
    if not result:
        return result

    with _thread_cache_lock:
        _thread_cache[chatlog_id] = result
        _thread_cache.move_to_end(chatlog_id)
        while len(_thread_cache) > _THREAD_CACHE_MAX:
            _thread_cache.popitem(last=False)
    return result


def _fetch_full_thread_uncached(chatlog_id: int) -> list[dict]:
    sql = """
    SELECT event_type,
           payload->>'question' AS question,
           payload->>'response' AS response
    FROM events
    WHERE event_type IN ('tutor_query', 'tutor_response')
      AND payload->>'conversation_id' = (
          SELECT payload->>'conversation_id'
          FROM events
          WHERE id = :chatlog_id
      )
    ORDER BY id ASC
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
        return []

    turns: list[dict] = []
    midx = 0
    student_idx = 0
    seen_query = False
    for et, q, r in rows:
        if et == "tutor_query" and q:
            seen_query = True
            turns.append({
                "message_index": midx,
                "role": "student",
                "text": q,
                "student_index": student_idx,
            })
            midx += 1
            student_idx += 1
        elif et == "tutor_response" and r and seen_query:
            turns.append({"message_index": midx, "role": "tutor", "text": r})
            midx += 1
    return turns
