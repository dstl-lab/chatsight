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

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

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


def _weekly_yes_rates(humans: list[LabelApplication], max_weeks: int = 8) -> list[int]:
    """Last `max_weeks` weeks of yes-rate (0–100), oldest → newest. Returns ≤max_weeks values.

    Only weeks with at least one yes-or-no decision contribute.
    """
    bucket: dict[str, dict[str, int]] = defaultdict(lambda: {"yes": 0, "no": 0})
    for a in humans:
        if a.value not in ("yes", "no"):
            continue
        bucket[_week_start(a.created_at)][a.value] += 1
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

    rows = []
    for ld in runs:
        apps = session.exec(
            select(LabelApplication).where(LabelApplication.label_id == ld.id)
        ).all()
        humans = [a for a in apps if a.applied_by == "human"]

        yes_n = sum(1 for a in humans if a.value == "yes")
        no_n = sum(1 for a in humans if a.value == "no")
        walked = len(
            {(a.chatlog_id, a.message_index) for a in humans if a.value in ("yes", "no", "skip")}
        )

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
                "walked": walked,
                "total_target": ld.classification_total,
                "disagreement_pct": _round_pct(disagree, overlap_count) if overlap_count else None,
                "overlap_count": overlap_count,
                "updated_at": _isoformat(_most_recent(apps, ld)),
                "weekly_sparkline": _weekly_yes_rates(humans),
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

    # ── weekly ──
    weekly_map: dict[str, dict[str, int]] = defaultdict(lambda: {"yes": 0, "no": 0})
    for a in humans:
        if a.value not in ("yes", "no"):
            continue
        weekly_map[_week_start(a.created_at)][a.value] += 1
    weekly = sorted(
        (
            {
                "week_start": w,
                "yes": v["yes"],
                "no": v["no"],
                "yes_pct": _round_pct(v["yes"], v["yes"] + v["no"]),
            }
            for w, v in weekly_map.items()
        ),
        key=lambda r: r["week_start"],
    )

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
    walked = len(
        {(a.chatlog_id, a.message_index) for a in humans if a.value in ("yes", "no", "skip")}
    )

    return {
        "run": {
            "id": ld.id,
            "label_name": ld.name,
            "description": ld.description,
            "phase": ld.phase,
            "updated_at": _isoformat(_most_recent(apps, ld)),
            "walked": walked,
            "total_target": ld.classification_total,
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
        "weekly": weekly,
        "examples": examples,
    }
