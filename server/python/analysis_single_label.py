"""Single-label analysis endpoints — cohort overview and run detail.

Reads from LabelApplication where the parent LabelDefinition has mode='single'.

Row states (the unique-constraint on (label_id, chatlog_id, message_index) means
each message has at most one row at any time):
- Pure human:        applied_by='human', value in ('yes','no','skip'),
                     ai_value_at_review IS NULL  (human-decided fresh)
- Reviewed AI:       applied_by='human', value in ('yes','no'),
                     ai_value_at_review NOT NULL  (human reviewed an AI prediction)
- Pure AI (pending): applied_by='ai',    value in ('yes','no'),
                     confidence usually set, never reviewed by a human

The "overlap set" (messages with both an AI prediction AND a human decision) is
exactly the Reviewed-AI rows above — captured via ai_value_at_review when
decision_service.upsert_decision overwrites an AI row.
"""

import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

try:
    from zoneinfo import ZoneInfo  # stdlib (Python 3.9+)
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from database import get_session
from models import AssignmentMapping, LabelApplication, LabelDefinition, MessageCache

router = APIRouter(prefix="/api/analysis/single-label", tags=["analysis"])


# ──────────────────────── helpers ────────────────────────


def _round_pct(num: int, denom: int) -> int:
    if denom == 0:
        return 0
    return round(100 * num / denom)


def _isoformat(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat() + "Z"


def _week_start(dt: datetime) -> str:
    """ISO date of the Monday on or before `dt`."""
    monday = dt - timedelta(days=dt.weekday())
    return monday.date().isoformat()


def _most_recent(apps: list[LabelApplication], ld: LabelDefinition) -> datetime:
    if not apps:
        return ld.created_at
    return max((a.created_at for a in apps), default=ld.created_at)


def _weekly_yes_rates(
    apps: list[LabelApplication],
    message_created_at: dict[tuple[int, int], datetime],
    max_weeks: int = 8,
) -> list[int]:
    """Last `max_weeks` weeks of yes-rate (0–100), oldest → newest. Returns ≤max_weeks values.

    Buckets by the **message's** creation date (from MessageCache.created_at)
    rather than the label application's timestamp, so the sparkline reflects
    when the conversations happened — not when an instructor or the AI
    labeled them. Both human and AI applications contribute (each message has
    at most one application per label via the unique constraint, so no double
    counting). Rows whose MessageCache lookup is missing or has no
    `created_at` are skipped.
    """
    bucket: dict[str, dict[str, int]] = defaultdict(lambda: {"yes": 0, "no": 0})
    for a in apps:
        if a.value not in ("yes", "no"):
            continue
        dt = message_created_at.get((a.chatlog_id, a.message_index))
        if dt is None:
            continue
        bucket[_week_start(dt)][a.value] += 1
    if not bucket:
        return []
    weeks_sorted = sorted(bucket.keys())[-max_weeks:]
    return [_round_pct(bucket[w]["yes"], bucket[w]["yes"] + bucket[w]["no"]) for w in weeks_sorted]


# ──────────────────────── /cohort ────────────────────────


@router.get("/cohort")
def get_cohort(session: Session = Depends(get_session)) -> dict:
    runs = session.exec(
        select(LabelDefinition)
        .where(LabelDefinition.mode == "single")
        .where(LabelDefinition.archived_at.is_(None))  # type: ignore[union-attr]
        .order_by(LabelDefinition.created_at)  # type: ignore[arg-type]
    ).all()

    # Build (chatlog_id, message_index) -> message-created-at lookup once for
    # every run's sparkline. Skips rows where the cache row is missing a
    # timestamp (they're excluded from the weekly buckets entirely).
    message_created_at: dict[tuple[int, int], datetime] = {
        (cid, midx): dt
        for cid, midx, dt in session.exec(
            select(
                MessageCache.chatlog_id,
                MessageCache.message_index,
                MessageCache.created_at,
            ).where(MessageCache.created_at.is_not(None))  # type: ignore[union-attr]
        ).all()
    }

    rows = []
    for ld in runs:
        apps = session.exec(
            select(LabelApplication).where(LabelApplication.label_id == ld.id)
        ).all()
        humans = [a for a in apps if a.applied_by == "human"]

        yes_n = sum(1 for a in humans if a.value == "yes")
        no_n = sum(1 for a in humans if a.value == "no")

        # Overlap = human-decided rows that have a captured AI snapshot.
        reviewed = [
            a for a in humans
            if a.ai_value_at_review in ("yes", "no") and a.value in ("yes", "no")
        ]
        overlap_count = len(reviewed)
        disagree = sum(1 for a in reviewed if a.ai_value_at_review != a.value)

        rows.append(
            {
                "run_id": ld.id,
                "label_name": ld.name,
                "description": ld.description,
                "phase": ld.phase,
                "yes_count": yes_n,
                "no_count": no_n,
                "yes_pct": _round_pct(yes_n, yes_n + no_n),
                "disagreement_pct": _round_pct(disagree, overlap_count) if overlap_count else None,
                "overlap_count": overlap_count,
                "updated_at": _isoformat(_most_recent(apps, ld)),
                "weekly_sparkline": _weekly_yes_rates(apps, message_created_at),
            }
        )

    return {"runs": rows}


# ──────────────────────── /runs/{run_id} ────────────────────────


def _confidence_bins_from_pairs(pairs: list[tuple[Optional[str], Optional[float]]]) -> list[dict]:
    """Each pair is (ai_value, ai_confidence). value should be 'yes' or 'no'."""
    bins = [
        {"lo": i / 10, "hi": (i + 1) / 10, "count": 0, "yes": 0, "no": 0}
        for i in range(10)
    ]
    for value, confidence in pairs:
        if confidence is None:
            continue
        c = max(0.0, min(1.0, confidence))
        idx = 9 if c >= 1.0 else int(c * 10)
        bins[idx]["count"] += 1
        if value == "yes":
            bins[idx]["yes"] += 1
        elif value == "no":
            bins[idx]["no"] += 1
    return bins


def _agreement_buckets(reviewed: list[LabelApplication]) -> list[dict]:
    """5 buckets of width 0.2 over `ai_confidence_at_review`; agreement_rate = agree / overlap_count.

    `reviewed` is the human-decided overlap set: rows where ai_value_at_review IS NOT NULL
    (i.e., a human reviewed an AI prediction). We bucket by the captured AI confidence.
    """
    edges = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0001]  # 1.0001 so 1.0 lands in last bucket
    buckets = [
        {
            "lo": edges[i],
            "hi": min(edges[i + 1], 1.0),
            "overlap_count": 0,
            "agree": 0,
            "agreement_rate": None,
        }
        for i in range(5)
    ]
    for a in reviewed:
        c = a.ai_confidence_at_review
        if c is None or a.ai_value_at_review not in ("yes", "no") or a.value not in ("yes", "no"):
            continue
        c = max(0.0, min(1.0, c))
        idx = next(i for i in range(5) if edges[i] <= c < edges[i + 1])
        buckets[idx]["overlap_count"] += 1
        if a.ai_value_at_review == a.value:
            buckets[idx]["agree"] += 1
    for b in buckets:
        if b["overlap_count"] > 0:
            b["agreement_rate"] = round(100 * b["agree"] / b["overlap_count"])
    return buckets


def _assignment_index(session: Session) -> dict[tuple[int, int], str]:
    cache = session.exec(select(MessageCache)).all()
    mappings = {am.id: am.name for am in session.exec(select(AssignmentMapping)).all()}
    out: dict[tuple[int, int], str] = {}
    for m in cache:
        if m.assignment_id and m.assignment_id in mappings:
            out[(m.chatlog_id, m.message_index)] = mappings[m.assignment_id]
    return out


def _message_text_index(session: Session) -> dict[tuple[int, int], str]:
    cache = session.exec(select(MessageCache)).all()
    return {(m.chatlog_id, m.message_index): m.message_text for m in cache}


def _created_at_index(session: Session) -> dict[tuple[int, int], datetime]:
    """(chatlog_id, message_index) → MessageCache.created_at when present."""
    cache = session.exec(select(MessageCache)).all()
    return {
        (m.chatlog_id, m.message_index): m.created_at
        for m in cache
        if m.created_at is not None
    }


def _conversation_length_index(session: Session) -> dict[int, int]:
    """chatlog_id → total message count in the conversation (MAX(message_index)+1)."""
    cache = session.exec(select(MessageCache)).all()
    max_by_chat: dict[int, int] = {}
    for m in cache:
        cur = max_by_chat.get(m.chatlog_id, -1)
        if m.message_index > cur:
            max_by_chat[m.chatlog_id] = m.message_index
    return {cid: idx + 1 for cid, idx in max_by_chat.items()}


def _analysis_tz() -> Optional[object]:
    """ANALYSIS_TIMEZONE env var resolved to a tzinfo object, or None."""
    if ZoneInfo is None:
        return None
    name = (os.getenv("ANALYSIS_TIMEZONE") or "America/Los_Angeles").strip()
    try:
        return ZoneInfo(name or "America/Los_Angeles")
    except Exception:
        return None


def _local_hour(dt: datetime, tz: Optional[object]) -> int:
    """Hour-of-day (0–23) in the analysis timezone. Naive timestamps are
    treated as UTC (Postgres timestamps without zone usually are)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if tz is not None:
        try:
            dt = dt.astimezone(tz)  # type: ignore[arg-type]
        except Exception:
            pass
    return dt.hour


def _by_hour_of_day(
    humans: list[LabelApplication],
    created_at_for: dict[tuple[int, int], datetime],
    tz: Optional[object],
) -> list[dict]:
    """[{hour, yes, no, yes_pct}], 24 entries (0–23), in hour order. Messages
    without a cached timestamp are excluded from the denominator."""
    buckets = [{"yes": 0, "no": 0} for _ in range(24)]
    for a in humans:
        if a.value not in ("yes", "no"):
            continue
        ts = created_at_for.get((a.chatlog_id, a.message_index))
        if ts is None:
            continue
        h = _local_hour(ts, tz)
        buckets[h][a.value] += 1
    return [
        {
            "hour": h,
            "yes": b["yes"],
            "no": b["no"],
            "yes_pct": _round_pct(b["yes"], b["yes"] + b["no"]),
        }
        for h, b in enumerate(buckets)
    ]


def _depth_bucket(total_msgs: int) -> str:
    if total_msgs <= 5:
        return "short"
    if total_msgs <= 15:
        return "mid"
    return "long"


def _by_conversation_depth(
    humans: list[LabelApplication],
    conv_length_for: dict[int, int],
) -> list[dict]:
    """[{bucket: short|mid|long, yes, no, yes_pct}]. Buckets: short ≤5,
    6–15, long 16+. Conversations without a cached length fall into the
    short bucket as a conservative default."""
    buckets = {
        "short": {"yes": 0, "no": 0},
        "mid": {"yes": 0, "no": 0},
        "long": {"yes": 0, "no": 0},
    }
    for a in humans:
        if a.value not in ("yes", "no"):
            continue
        total = conv_length_for.get(a.chatlog_id)
        if total is None:
            # Fall back to the message_index — at least this row's position
            # gives a lower bound on conversation length.
            total = a.message_index + 1
        buckets[_depth_bucket(total)][a.value] += 1
    return [
        {
            "bucket": b,
            "yes": v["yes"],
            "no": v["no"],
            "yes_pct": _round_pct(v["yes"], v["yes"] + v["no"]),
        }
        for b, v in buckets.items()
    ]


def _position_bucket(message_index: int) -> str:
    if message_index <= 2:
        return "early"
    if message_index <= 6:
        return "mid"
    return "late"


def _record_for(
    a: LabelApplication,
    flag: Optional[str],
    text_lookup: dict[tuple[int, int], str],
    assignment_for: dict[tuple[int, int], str],
) -> dict:
    """Build an example record. AI fields come from the live row when applied_by='ai',
    or from the snapshot columns when applied_by='human' and the row was reviewed."""
    if a.applied_by == "ai":
        ai_pred = a.value if a.value in ("yes", "no") else None
        ai_conf = a.confidence
    else:
        ai_pred = a.ai_value_at_review if a.ai_value_at_review in ("yes", "no") else None
        ai_conf = a.ai_confidence_at_review

    return {
        "message_id": a.id,
        "chatlog_id": a.chatlog_id,
        "message_index": a.message_index,
        "text": text_lookup.get((a.chatlog_id, a.message_index), "(message not cached)"),
        "ai_pred": ai_pred,
        "ai_confidence": ai_conf,
        "human_decision": a.value if a.applied_by == "human" and a.value in ("yes", "no") else None,
        "assignment": assignment_for.get((a.chatlog_id, a.message_index)),
        "position_bucket": _position_bucket(a.message_index),
        "created_at": _isoformat(a.created_at),
        "flag": flag,
    }


def _edge_records(
    apps: list[LabelApplication],
    text_lookup: dict[tuple[int, int], str],
    assignment_for: dict[tuple[int, int], str],
    cap: int = 8,
) -> list[dict]:
    """Edge cases worth flagging for review. Two sources:
    1. Pending AI predictions (applied_by='ai') with low confidence (0.4–0.6).
    2. Reviewed rows where the human overruled the AI (ai_value_at_review != value).
    Sorted by recency."""
    candidates: list[tuple[LabelApplication, str]] = []
    for a in apps:
        if a.applied_by == "ai":
            if a.value in ("yes", "no") and a.confidence is not None and 0.4 <= a.confidence <= 0.6:
                candidates.append((a, "low_confidence"))
        elif a.applied_by == "human":
            if (
                a.ai_value_at_review in ("yes", "no")
                and a.value in ("yes", "no")
                and a.ai_value_at_review != a.value
            ):
                candidates.append((a, "human_overruled"))
    candidates.sort(key=lambda pair: pair[0].created_at, reverse=True)
    return [_record_for(a, flag, text_lookup, assignment_for) for a, flag in candidates[:cap]]


@router.get("/runs/{run_id}")
def get_run_detail(run_id: int, session: Session = Depends(get_session)) -> dict:
    ld = session.get(LabelDefinition, run_id)
    if ld is None or ld.mode != "single" or ld.archived_at is not None:
        raise HTTPException(status_code=404, detail="run not found")

    apps = session.exec(
        select(LabelApplication).where(LabelApplication.label_id == run_id)
    ).all()
    humans = [a for a in apps if a.applied_by == "human"]
    ais = [a for a in apps if a.applied_by == "ai"]
    reviewed = [
        a for a in humans
        if a.ai_value_at_review in ("yes", "no") and a.value in ("yes", "no")
    ]

    # ── confidence histogram ──
    # Pending AI rows (live) PLUS captured snapshots from reviewed-human rows.
    # The histogram represents the distribution of the model's predictions over
    # this run, regardless of whether each one has since been reviewed.
    ai_view: list[tuple[Optional[str], Optional[float]]] = []
    for a in ais:
        ai_view.append((a.value, a.confidence))
    for a in reviewed:
        ai_view.append((a.ai_value_at_review, a.ai_confidence_at_review))
    ai_with_conf = [(v, c) for v, c in ai_view if c is not None]
    bins = _confidence_bins_from_pairs(ai_with_conf)

    # ── disagreement (over the reviewed overlap set) ──
    agree = disagree = ai_yes_human_no = ai_no_human_yes = 0
    for a in reviewed:
        if a.ai_value_at_review == a.value:
            agree += 1
        else:
            disagree += 1
            if a.ai_value_at_review == "yes" and a.value == "no":
                ai_yes_human_no += 1
            elif a.ai_value_at_review == "no" and a.value == "yes":
                ai_no_human_yes += 1
    overlap = agree + disagree

    # ── ai coverage ──
    # "Touched by AI" = pending AI rows + reviewed-human rows with a snapshot.
    ai_touched: set[tuple[int, int]] = {(a.chatlog_id, a.message_index) for a in ais}
    ai_touched.update((a.chatlog_id, a.message_index) for a in reviewed)
    total_msgs = session.exec(select(MessageCache)).all()
    total = len(total_msgs)
    ai_coverage = {
        "covered": len(ai_touched),
        "total": total,
        "pct": _round_pct(len(ai_touched), total),
    }

    # ── per-conversation yes-rate ──
    yes_chats = {a.chatlog_id for a in humans if a.value == "yes"}
    decided_chats = {a.chatlog_id for a in humans if a.value in ("yes", "no")}
    conv_yes_pct = _round_pct(len(yes_chats), len(decided_chats))

    # ── by assignment ──
    assignment_for = _assignment_index(session)
    by_assn: dict[str, dict[str, int]] = defaultdict(lambda: {"yes": 0, "no": 0})
    for a in humans:
        if a.value not in ("yes", "no"):
            continue
        name = assignment_for.get((a.chatlog_id, a.message_index), "Unassigned")
        by_assn[name][a.value] += 1
    by_assignment = [
        {"key": k, "yes": v["yes"], "no": v["no"], "yes_pct": _round_pct(v["yes"], v["yes"] + v["no"])}
        for k, v in by_assn.items()
    ]
    by_assignment.sort(key=lambda r: r["yes_pct"], reverse=True)

    # ── by position ──
    pos_buckets = {
        "early": {"yes": 0, "no": 0},
        "mid": {"yes": 0, "no": 0},
        "late": {"yes": 0, "no": 0},
    }
    for a in humans:
        if a.value not in ("yes", "no"):
            continue
        pos_buckets[_position_bucket(a.message_index)][a.value] += 1
    by_position = [
        {"bucket": b, "yes": v["yes"], "no": v["no"], "yes_pct": _round_pct(v["yes"], v["yes"] + v["no"])}
        for b, v in pos_buckets.items()
    ]

    # ── by hour-of-day & conversation depth ──
    # Both bucket on dimensions intrinsic to the message data (not the
    # labeling timeline), so they keep signal when labeling happens in
    # one sitting. Replaces the previous `weekly` time-series.
    created_at_for = _created_at_index(session)
    conv_length_for = _conversation_length_index(session)
    tz = _analysis_tz()
    by_hour_of_day = _by_hour_of_day(humans, created_at_for, tz)
    by_conversation_depth = _by_conversation_depth(humans, conv_length_for)

    # ── examples ──
    text_lookup = _message_text_index(session)
    yes_humans = sorted(
        [a for a in humans if a.value == "yes"], key=lambda x: x.created_at, reverse=True
    )[:8]
    no_humans = sorted(
        [a for a in humans if a.value == "no"], key=lambda x: x.created_at, reverse=True
    )[:8]
    examples = {
        "yes": [_record_for(a, None, text_lookup, assignment_for) for a in yes_humans],
        "no": [_record_for(a, None, text_lookup, assignment_for) for a in no_humans],
        "edge": _edge_records(apps, text_lookup, assignment_for),
    }

    yes_n = sum(1 for a in humans if a.value == "yes")
    no_n = sum(1 for a in humans if a.value == "no")

    return {
        "run": {
            "id": ld.id,
            "label_name": ld.name,
            "description": ld.description,
            "phase": ld.phase,
            "updated_at": _isoformat(_most_recent(apps, ld)),
            "yes_count": yes_n,
            "no_count": no_n,
            "yes_pct": _round_pct(yes_n, yes_n + no_n),
            "conv_yes_pct": conv_yes_pct,
        },
        "confidence_histogram": {
            "bins": bins,
            "coverage": {"with_confidence": len(ai_with_conf), "total_ai": len(ai_view)},
        },
        "ai_coverage": ai_coverage,
        "agreement_by_confidence": {"buckets": _agreement_buckets(reviewed)},
        "disagreement": {
            "overlap_count": overlap,
            "agree": agree,
            "disagree": disagree,
            "rate": _round_pct(disagree, overlap) if overlap else None,
            "breakdown": {
                "ai_yes_human_no": ai_yes_human_no,
                "ai_no_human_yes": ai_no_human_yes,
            },
        },
        "by_assignment": by_assignment,
        "by_position": by_position,
        "by_hour_of_day": by_hour_of_day,
        "by_conversation_depth": by_conversation_depth,
        "examples": examples,
    }
