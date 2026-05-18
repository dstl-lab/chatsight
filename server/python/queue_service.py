"""Queue logic for the single-label flow: pick the next conversation + message
that needs a decision for the active label."""
import hashlib
import logging
import math
import os
import random
import threading
from collections import OrderedDict
from typing import Optional, Tuple

from sqlalchemy import text as sql_text
from sqlmodel import Session, select

import assist_service
import explore_service
from database import ext_engine
from models import ConversationProfile, LabelApplication, MessageCache

logger = logging.getLogger(__name__)

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


def build_sampling_meta(
    session: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    conversation_student_messages: int,
    sampling_pick: str,
) -> dict:
    """Human-readable sampling diagnostics for the RUN UI."""
    if sampling_pick == "baseline":
        sampling_pick = "round_robin"
    unc_nov = neighbor_uncertainty_novelty(session, label_id, chatlog_id, message_index)
    labeled_centroids = explore_service.labeled_student_centroids(session, label_id)
    conv_nov = explore_service.conversation_novelty(
        session, label_id, chatlog_id, labeled_centroids
    )
    theme_nov = explore_service.theme_novelty(session, label_id, chatlog_id)
    pending_row = session.exec(
        select(MessageCache.message_text).where(
            MessageCache.chatlog_id == chatlog_id,
            MessageCache.message_index == message_index,
        )
    ).first()
    pending_str = (
        pending_row[0] if pending_row is not None and isinstance(pending_row, tuple) else pending_row
    )
    rarity = explore_service.student_message_corpus_rarity(session, chatlog_id, message_index)
    spec = (
        explore_service.student_help_specificity(
            pending_str or "", corpus_rarity=rarity
        )
        if pending_str is not None
        else None
    )
    paste_score = (
        explore_service.student_message_copy_paste_likelihood(pending_str or "")
        if pending_str is not None
        else None
    )
    profile = session.get(ConversationProfile, (label_id, chatlog_id))
    conversation_summary = (
        profile.one_liner.strip()
        if profile and profile.one_liner and profile.one_liner.strip()
        else None
    )

    meta = {
        "sampling_pick": sampling_pick,
        "conversation_student_messages": conversation_student_messages,
        "pending_student_message_number": message_index + 1,
        "neighbor_scores_available": unc_nov is not None,
        "neighbor_uncertainty_pct": None,
        "neighbor_novelty_pct": None,
        "conversation_novelty_pct": None,
        "theme_novelty_pct": None,
        "student_specificity_pct": int(round(spec * 100)) if spec is not None else None,
        "student_rarity_pct": int(round(rarity * 100)) if rarity is not None else None,
        "conversation_summary": conversation_summary,
        "pick_rationale": None,
        "sampling_hint": None,
    }
    if unc_nov:
        u, n = unc_nov
        meta["neighbor_uncertainty_pct"] = int(round(u * 100))
        meta["neighbor_novelty_pct"] = int(round(n * 100))
    if conv_nov is not None:
        meta["conversation_novelty_pct"] = int(round(conv_nov * 100))
    if theme_nov is not None:
        meta["theme_novelty_pct"] = int(round(theme_nov * 100))
    if sampling_pick == "explore":
        bits = []
        if unc_nov:
            bits.append("ambiguous neighbors")
        if conv_nov is not None and conv_nov >= 0.5:
            bits.append("unlike labeled conversations")
        if theme_nov is not None and theme_nov >= 0.5:
            bits.append("new theme vs prior chats")
        if paste_score is not None and paste_score >= 0.65:
            bits.append("likely copy-paste (deprioritized in explore)")
        elif spec is not None and spec >= 0.55:
            bits.append("specific student help (not generic spam)")
        if rarity is not None and rarity >= 0.5 and (paste_score or 0) < 0.65:
            bits.append("uncommon phrasing in the corpus")
        if bits:
            meta["pick_rationale"] = ", ".join(bits) + "."
        elif unc_nov:
            meta["pick_rationale"] = (
                "Neighbors disagree or look less like prior message labels."
            )
        else:
            meta["pick_rationale"] = (
                "Seeking specific, uncommon student help (scores still warming up)."
            )
    elif sampling_pick == "continue":
        meta["pick_rationale"] = (
            "Continue mode — finishing a chat you already started."
        )
    elif sampling_pick == "round_robin":
        meta["pick_rationale"] = (
            "Round-robin mode — next new chat in fair rotation, not Explore scoring."
        )
    elif not unc_nov:
        meta["pick_rationale"] = (
            "Neighbor scores not ready — need human yes/no labels on other messages "
            "with embeddings."
        )
    return meta


def default_hybrid_explore_fraction() -> float:
    """Server default when `LabelDefinition.hybrid_explore_fraction` is unset."""
    try:
        v = float(os.environ.get("CHATSIGHT_HYBRID_EXPLORE_FRACTION", "0.35"))
    except (TypeError, ValueError):
        v = 0.35
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
) -> Tuple[Optional[int], Optional[str]]:
    ip_pending = [
        c for c in in_progress
        if c in conv and _first_pending_turn(c, conv[c], decided)
    ]
    ns_pending = [
        c for c in not_started
        if c in conv and _first_pending_turn(c, conv[c], decided)
    ]
    if not ip_pending and not ns_pending:
        return None, None

    pool = ip_pending if ip_pending else ns_pending
    in_prog_bucket = bool(ip_pending)

    if len(pool) == 1:
        if in_prog_bucket:
            return pool[0], "continue"
        return pool[0], "round_robin"

    explore = random.random() < explore_fraction
    if not explore:
        if in_prog_bucket:
            pool_sorted = sorted(pool, key=lambda c: _shuffle_key(label_id, c))
            return pool_sorted[0], "continue"
        pool_sorted = sorted(
            pool,
            key=lambda c: (
                assign_by_cid.get(c) is None,
                assign_by_cid.get(c) if assign_by_cid.get(c) is not None else -1,
                _shuffle_key(label_id, c),
            ),
        )
        return pool_sorted[0], "round_robin"

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

    def _conversation_utility(cid: int) -> float:
        pending = _first_pending_turn(cid, conv[cid], decided)
        if not pending:
            return 0.0
        midx, text, _notebook = pending
        student_texts = [t for _i, t, _n in conv[cid]]
        result = neighbor_uncertainty_novelty(session, label_id, cid, midx)
        uncertainty, msg_nov = (result if result else (None, None))
        conv_nov = explore_service.conversation_novelty(
            session, label_id, cid, labeled_centroids
        )
        theme_nov = explore_service.theme_novelty(
            session, label_id, cid, theme_vectors
        )
        rarity = explore_service.student_message_corpus_rarity(session, cid, midx)
        spec = explore_service.student_help_specificity(text, corpus_rarity=rarity)
        spam = explore_service.conversation_spam_penalty(student_texts)
        return explore_service.blended_explore_utility(
            uncertainty,
            msg_nov,
            conv_nov,
            theme_nov,
            spec,
            rarity,
            spam,
        )

    utility_scores = {
        cid: _conversation_utility(cid) for cid in explore_candidates
    }
    scored = sorted(
        explore_candidates,
        key=lambda c: (-utility_scores[c], c),
    )
    top_k = max(1, (len(scored) + 3) // 4)
    explore_choices = [c for c in scored[:top_k]]

    return random.choice(explore_choices), "explore"


def next_message_for_label(
    session: Session,
    label_id: int,
    assignment_id: Optional[int] = None,
    explore_fraction: Optional[float] = None,
) -> Optional[dict]:
    eff_explore = (
        max(0.0, min(1.0, explore_fraction))
        if explore_fraction is not None
        else default_hybrid_explore_fraction()
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

    decided = set(
        session.exec(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .where(LabelApplication.label_id == label_id)
        ).all()
    )

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

    cid_pick, pick_mode = _select_next_chatlog_id(
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
    sampling_meta = build_sampling_meta(
        session,
        label_id,
        cid_pick,
        midx,
        len(conv[cid_pick]),
        pick_mode,
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
