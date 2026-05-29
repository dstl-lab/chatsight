"""Multi-label analysis endpoints — label cohort overview and per-label detail.

Counts only true multi-label applications (LabelApplication.value IS NULL on
mode='multi' labels). Single-label /run rows share the table but are excluded.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from database import get_session
from models import AssignmentMapping, LabelApplication, LabelDefinition, MessageCache

router = APIRouter(prefix="/api/analysis/multi-label", tags=["analysis"])

REVIEW_THRESHOLD = 0.75


def _is_multi_application():
    return LabelApplication.value.is_(None)


def _round_pct(num: int, denom: int) -> int:
    if denom == 0:
        return 0
    return round(100 * num / denom)


def _isoformat(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat() + "Z"


def _week_start(dt: datetime) -> str:
    monday = dt - timedelta(days=dt.weekday())
    return monday.date().isoformat()


def _position_bucket(message_index: int) -> str:
    if message_index <= 2:
        return "early"
    if message_index <= 6:
        return "mid"
    return "late"


def _weekly_application_counts(
    apps: list[LabelApplication],
    message_created_at: dict[tuple[int, int], datetime],
    max_weeks: int = 8,
) -> list[int]:
    """Distinct messages labeled per week, oldest → newest, normalized 0–100."""
    bucket: dict[str, set[tuple[int, int]]] = defaultdict(set)
    for a in apps:
        dt = message_created_at.get((a.chatlog_id, a.message_index))
        if dt is None:
            continue
        bucket[_week_start(dt)].add((a.chatlog_id, a.message_index))
    if not bucket:
        return []
    weeks_sorted = sorted(bucket.keys())[-max_weeks:]
    counts = [len(bucket[w]) for w in weeks_sorted]
    peak = max(counts) if counts else 1
    return [_round_pct(c, peak) for c in counts]


def _message_created_at_index(session: Session) -> dict[tuple[int, int], datetime]:
    return {
        (cid, midx): dt
        for cid, midx, dt in session.exec(
            select(
                MessageCache.chatlog_id,
                MessageCache.message_index,
                MessageCache.created_at,
            ).where(MessageCache.created_at.is_not(None))  # type: ignore[union-attr]
        ).all()
    }


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


def _confidence_bins(confidences: list[float]) -> list[dict]:
    bins = [{"lo": i / 10, "hi": (i + 1) / 10, "count": 0} for i in range(10)]
    for c in confidences:
        c = max(0.0, min(1.0, c))
        idx = 9 if c >= 1.0 else int(c * 10)
        bins[idx]["count"] += 1
    return bins


@router.get("/cohort")
def get_cohort(session: Session = Depends(get_session)) -> dict:
    labels = session.exec(
        select(LabelDefinition)
        .where(LabelDefinition.mode == "multi")
        .where(LabelDefinition.archived_at.is_(None))  # type: ignore[union-attr]
        .order_by(LabelDefinition.sort_order)  # type: ignore[arg-type]
    ).all()

    message_created_at = _message_created_at_index(session)
    rows = []
    for ld in labels:
        apps = session.exec(
            select(LabelApplication)
            .where(LabelApplication.label_id == ld.id)
            .where(_is_multi_application())
        ).all()
        human_msgs = {
            (a.chatlog_id, a.message_index)
            for a in apps
            if a.applied_by == "human"
        }
        ai_apps = [a for a in apps if a.applied_by == "ai"]
        ai_msgs = {(a.chatlog_id, a.message_index) for a in ai_apps}
        ai_confidences = [a.confidence for a in ai_apps if a.confidence is not None]
        high_conf = sum(1 for c in ai_confidences if c >= REVIEW_THRESHOLD)
        low_conf = len(ai_confidences) - high_conf
        total_msgs = len(human_msgs | ai_msgs)
        updated = max((a.created_at for a in apps), default=ld.created_at)

        rows.append(
            {
                "label_id": ld.id,
                "label_name": ld.name,
                "description": ld.description,
                "human_count": len(human_msgs),
                "ai_count": len(ai_msgs),
                "total_count": total_msgs,
                "high_conf_pct": _round_pct(high_conf, len(ai_confidences)) if ai_confidences else None,
                "low_conf_count": low_conf,
                "human_pct": _round_pct(len(human_msgs), total_msgs) if total_msgs else None,
                "updated_at": _isoformat(updated),
                "weekly_sparkline": _weekly_application_counts(apps, message_created_at),
            }
        )

    return {"labels": rows}


@router.get("/labels/{label_id}")
def get_label_detail(label_id: int, session: Session = Depends(get_session)) -> dict:
    ld = session.get(LabelDefinition, label_id)
    if ld is None or ld.mode != "multi" or ld.archived_at is not None:
        raise HTTPException(status_code=404, detail="label not found")

    apps = session.exec(
        select(LabelApplication)
        .where(LabelApplication.label_id == label_id)
        .where(_is_multi_application())
    ).all()
    humans = [a for a in apps if a.applied_by == "human"]
    ais = [a for a in apps if a.applied_by == "ai"]

    human_msgs = {(a.chatlog_id, a.message_index) for a in humans}
    ai_msgs = {(a.chatlog_id, a.message_index) for a in ais}
    all_msgs = human_msgs | ai_msgs
    total_apps = len(apps)

    ai_confidences = [a.confidence for a in ais if a.confidence is not None]
    bins = _confidence_bins(ai_confidences)

    assignment_for = _assignment_index(session)
    text_lookup = _message_text_index(session)
    created_at_for = _message_created_at_index(session)

    # Position distribution (all applications)
    pos_counts = {"early": 0, "mid": 0, "late": 0}
    for a in apps:
        pos_counts[_position_bucket(a.message_index)] += 1
    position_distribution = [
        {
            "bucket": b,
            "count": pos_counts[b],
            "pct": _round_pct(pos_counts[b], total_apps),
        }
        for b in ("early", "mid", "late")
    ]

    # By assignment: human vs ai counts
    by_assn: dict[str, dict[str, int]] = defaultdict(lambda: {"human": 0, "ai": 0})
    for a in apps:
        name = assignment_for.get((a.chatlog_id, a.message_index), "Unassigned")
        by_assn[name][a.applied_by or "human"] += 1
    by_assignment = [
        {
            "key": k,
            "human": v["human"],
            "ai": v["ai"],
            "total": v["human"] + v["ai"],
            "human_pct": _round_pct(v["human"], v["human"] + v["ai"]),
        }
        for k, v in by_assn.items()
    ]
    by_assignment.sort(key=lambda r: r["total"], reverse=True)

    # Co-occurring labels on the same messages
    other_labels: dict[str, int] = defaultdict(int)
    co_index: dict[tuple[int, int], list[str]] = defaultdict(list)
    if all_msgs:
        co_rows = session.exec(
            select(LabelDefinition.name, LabelApplication.chatlog_id, LabelApplication.message_index)
            .select_from(LabelApplication)
            .join(LabelDefinition, LabelDefinition.id == LabelApplication.label_id)
            .where(LabelApplication.label_id != label_id)
            .where(_is_multi_application())
            .where(LabelDefinition.mode == "multi")
        ).all()
        msg_set = all_msgs
        for name, cid, midx in co_rows:
            key = (cid, midx)
            if key in msg_set:
                other_labels[name] += 1
                co_index[key].append(name)
    co_occurring = [
        {
            "label_name": name,
            "count": cnt,
            "pct": _round_pct(cnt, len(all_msgs)),
        }
        for name, cnt in sorted(other_labels.items(), key=lambda x: x[1], reverse=True)
    ][:12]

    # Hour of day (message timestamp)
    hour_buckets = [0] * 24
    for a in apps:
        ts = created_at_for.get((a.chatlog_id, a.message_index))
        if ts is None:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        hour_buckets[ts.hour % 24] += 1
    by_hour_of_day = [{"hour": h, "count": hour_buckets[h]} for h in range(24)]

    def _example(a: LabelApplication, flag: str | None = None) -> dict:
        key = (a.chatlog_id, a.message_index)
        return {
            "message_id": a.id,
            "chatlog_id": a.chatlog_id,
            "message_index": a.message_index,
            "text": text_lookup.get(key, "(message not cached)"),
            "applied_by": a.applied_by,
            "confidence": a.confidence,
            "assignment": assignment_for.get(key),
            "position_bucket": _position_bucket(a.message_index),
            "co_labels": co_index.get(key, []),
            "created_at": _isoformat(a.created_at),
            "flag": flag,
        }

    human_examples = sorted(humans, key=lambda a: a.created_at, reverse=True)[:8]
    low_conf_candidates = sorted(
        [a for a in ais if a.confidence is not None and a.confidence < REVIEW_THRESHOLD],
        key=lambda a: a.confidence or 0,
    )[:8]

    updated = max((a.created_at for a in apps), default=ld.created_at)

    # Paired single-label promotion, if any
    paired = session.exec(
        select(LabelDefinition)
        .where(LabelDefinition.paired_label_id == label_id)
        .where(LabelDefinition.archived_at.is_(None))  # type: ignore[union-attr]
    ).first()

    paired_summary = None
    if paired:
        from decision_service import label_counts

        yes, no, skip, _ = label_counts(session, paired.id)
        paired_summary = {
            "label_id": paired.id,
            "label_name": paired.name,
            "phase": paired.phase,
            "yes": yes,
            "no": no,
            "skip": skip,
        }

    return {
        "label": {
            "id": ld.id,
            "label_name": ld.name,
            "description": ld.description,
            "updated_at": _isoformat(updated),
            "human_count": len(human_msgs),
            "ai_count": len(ai_msgs),
            "total_count": len(all_msgs),
            "human_pct": _round_pct(len(human_msgs), len(all_msgs)) if all_msgs else None,
        },
        "confidence_histogram": {
            "bins": bins,
            "coverage": {
                "with_confidence": len(ai_confidences),
                "total_ai": len(ais),
            },
        },
        "provenance": {
            "human_applications": len(humans),
            "ai_applications": len(ais),
            "human_pct": _round_pct(len(humans), total_apps) if total_apps else None,
        },
        "position_distribution": position_distribution,
        "by_assignment": by_assignment,
        "co_occurring_labels": co_occurring,
        "by_hour_of_day": by_hour_of_day,
        "examples": {
            "human": [_example(a) for a in human_examples],
            "low_confidence": [_example(a, "low_confidence") for a in low_conf_candidates],
        },
        "paired_single_label": paired_summary,
    }
