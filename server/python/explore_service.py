"""Explore sampling: student-message-centric novelty for hybrid queue.

Prioritizes rare, specific student help requests over long threads of generic
\"help\" / \"question 1.2\" spam and over copy-pasted assignment prompts, errors,
or code dumps (long but not distinctive). Tutor turns are excluded from
conversation similarity; embeddings compare student messages only.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from collections import Counter
from datetime import datetime
from typing import Any, Optional

import numpy as np
from google import genai
from google.genai import types
from sqlalchemy import func
from sqlmodel import Session, select

import assist_service
import binary_autolabel_service
from concept_service import EMBED_API_MODEL, EMBED_MODEL
from database import engine
from models import (
    ConversationProfile,
    LabelApplication,
    LabelDefinition,
    LabelExploreGradebook,
    MessageCache,
    MessageEmbedding,
)

logger = logging.getLogger(__name__)

_client: genai.Client | None = None
_warm_lock = threading.Lock()


def _gemini_available() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


def _client_get() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


def _normalize(vec: np.ndarray) -> Optional[np.ndarray]:
    n = float(np.linalg.norm(vec))
    if n <= 0.0:
        return None
    return (vec / n).astype(np.float32)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.clip(np.dot(a, b), -1.0, 1.0))


def human_label_count(session: Session, label_id: int) -> int:
    return int(
        session.exec(
            select(func.count())
            .select_from(LabelApplication)
            .where(
                LabelApplication.label_id == label_id,
                LabelApplication.applied_by == "human",
                LabelApplication.value.in_(["yes", "no"]),  # noqa: comparator
            )
        ).one()
    )


def labeled_chatlog_ids(session: Session, label_id: int) -> set[int]:
    rows = session.exec(
        select(LabelApplication.chatlog_id)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
            LabelApplication.value.in_(["yes", "no"]),  # noqa: comparator
        )
        .distinct()
    ).all()
    return set(rows)


_GENERIC_HELP_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*help\s*[!?.]*\s*$", re.I),
    re.compile(r"^\s*(can you )?help( me)?( with this)?\s*[!?.]*\s*$", re.I),
    re.compile(r"^\s*i\s*['']?m\s+stuck\s*[!?.]*\s*$", re.I),
    re.compile(r"^\s*i\s+don\s*['']?t\s+get\s+it\s*[!?.]*\s*$", re.I),
    re.compile(
        r"^\s*(question|q|problem|part|exercise)\s*[#:]?\s*[\d.]+\s*[!?.]*\s*$",
        re.I,
    ),
    re.compile(r"^\s*what\s+do\s+i\s+do\s*[!?.]*\s*$", re.I),
    re.compile(r"^\s*how\s+do\s+i\s+(do|solve)\s+(this|it)\s*[!?.]*\s*$", re.I),
)

_SPECIFIC_SIGNALS: tuple[str, ...] = (
    "example",
    "groupby",
    "merge",
    "why does",
    "why is",
    "how do i use",
    "in the context of",
    "this line",
    "my code",
    "dataframe",
    "plot",
    "function",
)

# Homework prompts / specs students paste wholesale (not original questions).
_PASTE_BODY_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"traceback \(most recent call last\)", re.I),
    re.compile(r"```"),
    re.compile(r"^\s*\d+[\.)]\s+\S", re.M),
    re.compile(
        r"\b(write a function|using the (following )?dataset|you should submit|"
        r"your task is to|complete the following|fill in the blank)\b",
        re.I,
    ),
    re.compile(
        r"\b(read the (following )?prompt|answer the questions below|"
        r"show your work for)\b",
        re.I,
    ),
)

_PASTE_HEADER_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"^\s*(question|problem|part|exercise|lab|homework|hw)\s*[#:.]?\s*[\w\d.]",
        re.I | re.M,
    ),
)


def _first_person_density(text: str) -> float:
    """Share of words that look like the student speaking in their own voice."""
    words = re.findall(r"[a-zA-Z']+", text.lower())
    if not words:
        return 0.0
    first_person = sum(
        1 for w in words if w in ("i", "i'm", "im", "my", "me", "we", "our", "i've", "i'd")
    )
    return first_person / len(words)


def student_message_copy_paste_likelihood(text: str) -> float:
    """Likelihood the student message is pasted spec/code/error, not an original ask."""
    t = (text or "").strip()
    if not t:
        return 0.0
    score = 0.0
    lower = t.lower()
    n = len(t)

    for pat in _PASTE_BODY_PATTERNS:
        if pat.search(t):
            score = max(score, 0.75)

    for pat in _PASTE_HEADER_PATTERNS:
        if pat.search(t):
            score = max(score, 0.7)

    # Long blocks with almost no student voice → pasted instructions.
    if n >= 180:
        fp = _first_person_density(t)
        if fp < 0.012:
            score = max(score, 0.88)
        elif fp < 0.025 and n >= 350:
            score = max(score, 0.8)
        elif n >= 600 and fp < 0.04:
            score = max(score, 0.75)

    # Many lines / bullets like an assignment handout.
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    if n >= 250 and len(lines) >= 6:
        numbered = sum(1 for ln in lines if re.match(r"^\d+[\.)]\s", ln))
        if numbered >= 3 or len(lines) >= 10:
            score = max(score, 0.72)

    # Repeated identical lines (paste spam within one message).
    if len(lines) >= 3:
        top = Counter(lines).most_common(1)[0][1]
        if top >= 3:
            score = max(score, 0.65)

    # Error dumps without a short student question wrapped around them.
    if "traceback" in lower and n > 200 and _first_person_density(t) < 0.02:
        score = max(score, 0.9)

    return min(1.0, score)


def student_help_genericness(text: str) -> float:
    """How generic / repetitive a student help message is, in [0, 1]."""
    t = (text or "").strip()
    if not t:
        return 1.0
    paste = student_message_copy_paste_likelihood(t)
    if paste >= 0.7:
        return max(0.88, paste)

    if len(t) <= 12:
        return 0.92
    for pat in _GENERIC_HELP_PATTERNS:
        if pat.match(t):
            return 0.9
    lower = t.lower()
    if len(t) < 35 and t.count("?") == 0 and not any(s in lower for s in _SPECIFIC_SIGNALS):
        return max(0.72, paste)
    if any(s in lower for s in _SPECIFIC_SIGNALS):
        base = max(0.0, 0.35 - len(t) / 1200.0)
        return max(base, paste * 0.85)
    # Longer original questions — don't treat length alone as specific.
    base = max(0.0, min(1.0, 0.65 - len(t) / 500.0))
    return max(base, paste * 0.9)


def student_help_specificity(
    text: str,
    *,
    corpus_rarity: Optional[float] = None,
) -> float:
    """Specific, original student ask — down-ranks paste and corpus-common long text."""
    t = (text or "").strip()
    generic = student_help_genericness(t)
    paste = student_message_copy_paste_likelihood(t)
    spec = (1.0 - generic) * (1.0 - paste)
    # Same long text pasted by many students → common in embeddings, not novel.
    if corpus_rarity is not None and len(t) >= 120 and corpus_rarity < 0.3:
        spec *= max(0.15, corpus_rarity / 0.3)
    return max(0.0, min(1.0, spec))


def conversation_centroid(session: Session, chatlog_id: int) -> Optional[np.ndarray]:
    """Unit-normalized mean of **student** message embeddings in a conversation."""
    rows = session.exec(
        select(MessageEmbedding.embedding)
        .join(
            MessageCache,
            (MessageCache.chatlog_id == MessageEmbedding.chatlog_id)
            & (MessageCache.message_index == MessageEmbedding.message_index),
        )
        .where(
            MessageEmbedding.chatlog_id == chatlog_id,
            MessageEmbedding.model_version == EMBED_MODEL,
        )
    ).all()
    if not rows:
        return None
    vecs = []
    for row in rows:
        emb_bytes = row[0] if isinstance(row, (tuple, list)) else row
        v = _normalize(np.frombuffer(emb_bytes, dtype=np.float32))
        if v is not None:
            vecs.append(v)
    if not vecs:
        return None
    mean = np.mean(np.stack(vecs), axis=0)
    return _normalize(mean)


def conversation_spam_penalty(student_texts: list[str]) -> float:
    """Penalize generic pings and copy-paste spam threads, in [0, 1]."""
    if not student_texts:
        return 0.0
    paste = [student_message_copy_paste_likelihood(t) for t in student_texts]
    avg_paste = sum(paste) / len(paste)
    if avg_paste >= 0.75 and len(student_texts) >= 1:
        return min(1.0, 0.5 + 0.15 * len(student_texts))
    if len(student_texts) < 2:
        return 0.0
    generic = [student_help_genericness(t) for t in student_texts]
    avg = sum(generic) / len(generic)
    if avg < 0.6:
        return max(0.0, avg_paste - 0.4)
    # Many short generic messages in one chat (e.g. repeated "help").
    if len(student_texts) >= 3 and avg >= 0.75:
        return min(1.0, 0.45 + 0.12 * (len(student_texts) - 2))
    if len(student_texts) >= 2 and avg >= 0.85:
        return 0.55
    return max(0.0, avg - 0.5, avg_paste - 0.35)


def _corpus_rarity_max_refs() -> int:
    try:
        return max(50, int(os.environ.get("CHATSIGHT_CORPUS_RARITY_MAX_REFS", "512")))
    except (TypeError, ValueError):
        return 512


def student_message_corpus_rarity(
    session: Session, chatlog_id: int, message_index: int
) -> Optional[float]:
    """1 − max cosine sim of this student message to a subsample of the corpus."""
    cache = assist_service._get_cache(session)
    matrix = cache.get("matrix")
    keys_idx = cache.get("keys_idx") or {}
    if matrix is None:
        return None
    idx = keys_idx.get((chatlog_id, message_index))
    if idx is None:
        return None
    focused = matrix[idx]
    n = matrix.shape[0]
    max_refs = min(n, _corpus_rarity_max_refs())
    if n <= max_refs:
        sims = matrix @ focused
        sims = sims.copy()
        sims[idx] = -1.0
        max_sim = float(np.max(sims))
    else:
        # Deterministic subsample — fast on large corpora (avoids blocking /next).
        seed = (chatlog_id * 1_000_003) ^ (message_index * 9176) ^ n
        rng = np.random.default_rng(seed & 0xFFFFFFFF)
        sample_idx = rng.choice(n, size=max_refs, replace=False)
        sample_idx = sample_idx[sample_idx != idx]
        if sample_idx.size == 0:
            return None
        max_sim = float(np.max(matrix[sample_idx] @ focused))
    if max_sim < 0.0:
        return None
    return 1.0 - max(0.0, min(1.0, max_sim))


def explore_candidate_priority(
    session: Session,
    chatlog_id: int,
    pending_text: str,
    pending_index: int,
    student_texts: list[str],
    *,
    use_corpus_rarity: bool = False,
) -> float:
    """Rank explore shortlist: specific student help, not raw length (fast by default)."""
    rarity: Optional[float] = None
    if use_corpus_rarity:
        rarity = student_message_corpus_rarity(session, chatlog_id, pending_index)
    spec = student_help_specificity(pending_text, corpus_rarity=rarity)
    if rarity is None:
        rarity = spec
    spam = conversation_spam_penalty(student_texts)
    return (0.45 * spec + 0.55 * rarity) * (1.0 - spam)


def explore_score_pool_cap() -> int:
    try:
        return max(10, int(os.environ.get("CHATSIGHT_EXPLORE_SCORE_POOL_CAP", "60")))
    except (TypeError, ValueError):
        return 60


def labeled_student_centroids(
    session: Session, label_id: int
) -> dict[int, np.ndarray]:
    """Student-message centroids for each conversation with a human label."""
    out: dict[int, np.ndarray] = {}
    for cid in labeled_chatlog_ids(session, label_id):
        cent = conversation_centroid(session, cid)
        if cent is not None:
            out[cid] = cent
    return out


def conversation_novelty(
    session: Session,
    label_id: int,
    chatlog_id: int,
    labeled_centroids: Optional[dict[int, np.ndarray]] = None,
) -> Optional[float]:
    """1 − max cosine similarity to student centroids of other labeled conversations."""
    cand = conversation_centroid(session, chatlog_id)
    if cand is None:
        return None
    if labeled_centroids is None:
        labeled_centroids = labeled_student_centroids(session, label_id)
    max_sim = 0.0
    found = False
    for cid, cent in labeled_centroids.items():
        if cid == chatlog_id:
            continue
        found = True
        max_sim = max(max_sim, _cosine(cand, cent))
    if not found:
        return None
    return 1.0 - max_sim


def _profile_vector(profile: ConversationProfile) -> Optional[np.ndarray]:
    return _normalize(np.frombuffer(profile.summary_embedding, dtype=np.float32))


def labeled_theme_vectors(
    session: Session, label_id: int
) -> dict[int, np.ndarray]:
    """Cached summary embeddings for labeled conversations (one query)."""
    labeled = labeled_chatlog_ids(session, label_id)
    if not labeled:
        return {}
    rows = session.exec(
        select(ConversationProfile).where(
            ConversationProfile.label_id == label_id,
            ConversationProfile.chatlog_id.in_(labeled),  # noqa: comparator
        )
    ).all()
    out: dict[int, np.ndarray] = {}
    for prof in rows:
        vec = _profile_vector(prof)
        if vec is not None:
            out[prof.chatlog_id] = vec
    return out


def theme_novelty(
    session: Session,
    label_id: int,
    chatlog_id: int,
    labeled_vectors: Optional[dict[int, np.ndarray]] = None,
) -> Optional[float]:
    """1 − max similarity of this chat's summary to labeled conversation summaries."""
    if labeled_vectors is None:
        labeled_vectors = labeled_theme_vectors(session, label_id)
    vec = labeled_vectors.get(chatlog_id)
    if vec is None:
        prof = session.get(ConversationProfile, (label_id, chatlog_id))
        if prof is None:
            return None
        vec = _profile_vector(prof)
        if vec is None:
            return None
    max_sim = 0.0
    found = False
    for cid, ovec in labeled_vectors.items():
        if cid == chatlog_id:
            continue
        found = True
        max_sim = max(max_sim, _cosine(vec, ovec))
    if not found:
        return None
    return 1.0 - max_sim


def get_gradebook(session: Session, label_id: int) -> Optional[dict[str, Any]]:
    row = session.get(LabelExploreGradebook, label_id)
    if not row:
        return None
    try:
        return json.loads(row.gradebook_json)
    except json.JSONDecodeError:
        return None


def ensure_gradebook(session: Session, label_id: int) -> Optional[dict[str, Any]]:
    """Build or refresh label gradebook from human yes/no samples (Layer B)."""
    if not _gemini_available():
        return get_gradebook(session, label_id)

    count = human_label_count(session, label_id)
    if count < 3:
        return get_gradebook(session, label_id)

    existing = session.get(LabelExploreGradebook, label_id)
    if existing and (count - existing.human_label_count) < 5:
        return json.loads(existing.gradebook_json)

    label = session.get(LabelDefinition, label_id)
    if not label:
        return None

    yes_texts: list[str] = []
    no_texts: list[str] = []
    apps = session.exec(
        select(
            LabelApplication.value,
            MessageCache.message_text,
        )
        .join(
            MessageCache,
            (MessageCache.chatlog_id == LabelApplication.chatlog_id)
            & (MessageCache.message_index == LabelApplication.message_index),
        )
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
            LabelApplication.value.in_(["yes", "no"]),  # noqa: comparator
        )
    ).all()
    for value, text in apps:
        if value == "yes":
            yes_texts.append(text)
        elif value == "no":
            no_texts.append(text)

    try:
        patterns = binary_autolabel_service.summarize_batch(
            label.name,
            label.description,
            yes_texts,
            no_texts,
        )
    except Exception as exc:
        logger.warning("gradebook summarize_batch failed label_id=%s: %s", label_id, exc)
        return get_gradebook(session, label_id)

    gb = {
        "included": patterns.get("included", []),
        "excluded": patterns.get("excluded", []),
    }
    now = datetime.utcnow()
    if existing:
        existing.gradebook_json = json.dumps(gb)
        existing.human_label_count = count
        existing.updated_at = now
        session.add(existing)
    else:
        session.add(
            LabelExploreGradebook(
                label_id=label_id,
                gradebook_json=json.dumps(gb),
                human_label_count=count,
                updated_at=now,
            )
        )
    session.commit()
    return gb


_SUMMARY_TOOL = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="summarize_conversation",
            description="One-line theme summary for a student-AI tutoring conversation.",
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "one_liner": types.Schema(
                        type=types.Type.STRING,
                        description="Single sentence: what this conversation is mainly about.",
                    ),
                    "theme_tags": types.Schema(
                        type=types.Type.ARRAY,
                        items=types.Schema(type=types.Type.STRING),
                        description="3-5 short theme tags.",
                    ),
                },
                required=["one_liner", "theme_tags"],
            ),
        )
    ]
)

_SUMMARY_CONFIG = types.GenerateContentConfig(
    system_instruction=(
        "Summarize ONLY what the student is asking for in their own words — "
        "ignore how the AI tutor responded. Do NOT treat copy-pasted homework "
        "prompts, lab instructions, long error tracebacks, or code blocks as "
        "distinctive themes; flag those as pasted content if they dominate. "
        "Distinguish generic pings (\"help\", \"question 1.2\") from specific "
        "original help requests (e.g. wanting an example of groupby in context). "
        "Keep one_liner under 200 characters; theme_tags are 2-4 words each."
    ),
    temperature=0.2,
    tools=[_SUMMARY_TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["summarize_conversation"],
        )
    ),
)


def _summarize_conversation_gemini(
    label_name: str,
    label_description: Optional[str],
    notebook: Optional[str],
    student_texts: list[str],
    gradebook: Optional[dict[str, Any]],
) -> dict[str, Any]:
    parts = [f"Label: {label_name}"]
    if label_description:
        parts.append(f"Description: {label_description}")
    if notebook:
        parts.append(f"Notebook: {notebook}")
    if gradebook:
        inc = gradebook.get("included") or []
        exc = gradebook.get("excluded") or []
        if inc:
            parts.append("Themes already labeled YES (patterns): " + ", ".join(str(x) for x in inc[:8]))
        if exc:
            parts.append("Themes already labeled NO (patterns): " + ", ".join(str(x) for x in exc[:8]))
    parts.append("\nStudent messages (in order):")
    for i, t in enumerate(student_texts[:12]):
        parts.append(f"{i + 1}. {t[:500]}")
    response = _client_get().models.generate_content(
        model="gemini-2.0-flash",
        contents="\n".join(parts),
        config=_SUMMARY_CONFIG,
    )
    for part in response.candidates[0].content.parts:
        if part.function_call and part.function_call.name == "summarize_conversation":
            args = part.function_call.args or {}
            return {
                "one_liner": str(args.get("one_liner", "")).strip(),
                "theme_tags": list(args.get("theme_tags", [])),
            }
    return {"one_liner": "", "theme_tags": []}


def _embed_summary_text(text: str) -> Optional[np.ndarray]:
    if not text.strip():
        return None
    try:
        result = _client_get().models.embed_content(
            model=EMBED_API_MODEL,
            contents=[text],
        )
        vec = np.array(result.embeddings[0].values, dtype=np.float32)
        return _normalize(vec)
    except Exception as exc:
        logger.warning("summary embed failed: %s", exc)
        return None


def ensure_conversation_profile(
    session: Session,
    label_id: int,
    chatlog_id: int,
    student_texts: list[str],
    notebook: Optional[str],
) -> Optional[ConversationProfile]:
    """Create or refresh cached conversation summary + embedding (Layer B)."""
    if not _gemini_available() or not student_texts:
        return session.get(ConversationProfile, (label_id, chatlog_id))

    count = human_label_count(session, label_id)
    existing = session.get(ConversationProfile, (label_id, chatlog_id))
    if existing and (count - existing.human_label_count_at_build) < 5:
        return existing

    label = session.get(LabelDefinition, label_id)
    if not label:
        return existing

    gradebook = ensure_gradebook(session, label_id)
    try:
        summary = _summarize_conversation_gemini(
            label.name,
            label.description,
            notebook,
            student_texts,
            gradebook,
        )
    except Exception as exc:
        logger.warning(
            "conversation summarize failed label=%s chat=%s: %s",
            label_id,
            chatlog_id,
            exc,
        )
        return existing

    one_liner = summary.get("one_liner") or ""
    if not one_liner:
        return existing
    # Embed student-help theme only (not tutor context).
    student_blurb = "Student help: " + one_liner
    vec = _embed_summary_text(student_blurb)
    if vec is None:
        return existing

    now = datetime.utcnow()
    tags_json = json.dumps(summary.get("theme_tags", []))
    if existing:
        existing.one_liner = one_liner
        existing.theme_tags_json = tags_json
        existing.summary_embedding = vec.tobytes()
        existing.human_label_count_at_build = count
        existing.updated_at = now
        session.add(existing)
    else:
        existing = ConversationProfile(
            label_id=label_id,
            chatlog_id=chatlog_id,
            one_liner=one_liner,
            theme_tags_json=tags_json,
            summary_embedding=vec.tobytes(),
            human_label_count_at_build=count,
            updated_at=now,
        )
        session.add(existing)
    session.commit()
    session.refresh(existing)
    return existing


def _student_texts_for_chatlog(
    conv: dict[int, list[tuple[int, str, Optional[str]]]], chatlog_id: int
) -> list[str]:
    msgs = conv.get(chatlog_id, [])
    return [text for _midx, text, _nb in sorted(msgs, key=lambda t: t[0])]


def warm_explore_candidates(
    label_id: int,
    chatlog_ids: list[int],
    conv: dict[int, list[tuple[int, str, Optional[str]]]],
    notebooks: dict[int, Optional[str]],
) -> None:
    """Background: gradebook + conversation profiles for explore shortlist."""
    if not _gemini_available() or not chatlog_ids:
        return
    ids = list(chatlog_ids)

    def _run() -> None:
        try:
            with Session(engine) as session:
                with _warm_lock:
                    ensure_gradebook(session, label_id)
                for cid in ids:
                    texts = _student_texts_for_chatlog(conv, cid)
                    if not texts:
                        continue
                    with _warm_lock:
                        ensure_conversation_profile(
                            session,
                            label_id,
                            cid,
                            texts,
                            notebooks.get(cid),
                        )
                labeled = labeled_chatlog_ids(session, label_id)
            for cid in labeled:
                if cid in ids:
                    continue
                texts = _student_texts_for_chatlog(conv, cid)
                if not texts:
                    continue
                try:
                    with Session(engine) as session:
                        with _warm_lock:
                            ensure_conversation_profile(
                                session,
                                label_id,
                                cid,
                                texts,
                                notebooks.get(cid),
                            )
                except Exception as exc:
                    logger.warning("warm labeled profile %s failed: %s", cid, exc)
        except Exception as exc:
            logger.warning("warm_explore_candidates failed: %s", exc)

    threading.Thread(target=_run, daemon=True).start()


def explore_score_weights() -> dict[str, float]:
    """Normalized weights for utility blend; missing components are renormalized."""
    def _f(key: str, default: float) -> float:
        try:
            return max(0.0, float(os.environ.get(key, str(default))))
        except (TypeError, ValueError):
            return default

    return {
        "uncertainty": _f("CHATSIGHT_EXPLORE_UNC_WEIGHT", "0.28"),
        "message_novelty": _f("CHATSIGHT_EXPLORE_MSG_NOV_WEIGHT", "0.12"),
        "conversation_novelty": _f("CHATSIGHT_EXPLORE_CONV_NOV_WEIGHT", "0.15"),
        "theme_novelty": _f("CHATSIGHT_EXPLORE_THEME_NOV_WEIGHT", "0.15"),
        "student_specificity": _f("CHATSIGHT_EXPLORE_SPEC_WEIGHT", "0.15"),
        "student_rarity": _f("CHATSIGHT_EXPLORE_RARITY_WEIGHT", "0.15"),
    }


def blended_explore_utility(
    uncertainty: Optional[float],
    message_novelty: Optional[float],
    conversation_novelty: Optional[float],
    theme_novelty: Optional[float],
    student_specificity: Optional[float],
    student_rarity: Optional[float],
    spam_penalty: float = 0.0,
) -> float:
    weights = explore_score_weights()
    parts: list[tuple[float, float]] = []
    if uncertainty is not None:
        parts.append((uncertainty, weights["uncertainty"]))
    if message_novelty is not None:
        parts.append((message_novelty, weights["message_novelty"]))
    if conversation_novelty is not None:
        parts.append((conversation_novelty, weights["conversation_novelty"]))
    if theme_novelty is not None:
        parts.append((theme_novelty, weights["theme_novelty"]))
    if student_specificity is not None:
        parts.append((student_specificity, weights["student_specificity"]))
    if student_rarity is not None:
        parts.append((student_rarity, weights["student_rarity"]))
    if not parts:
        base = student_specificity if student_specificity is not None else 0.0
    else:
        wsum = sum(w for _, w in parts)
        base = sum(v * w for v, w in parts) / wsum if wsum > 0.0 else 0.0
    try:
        spam_w = float(os.environ.get("CHATSIGHT_EXPLORE_SPAM_PENALTY", "0.85"))
    except (TypeError, ValueError):
        spam_w = 0.85
    spam_w = max(0.0, min(1.0, spam_w))
    return base * (1.0 - spam_w * max(0.0, min(1.0, spam_penalty)))


