from datetime import datetime, timedelta

from sqlmodel import Session

from models import LabelApplication, LabelDefinition


def _make_run(session: Session, name: str, phase: str = "labeling") -> LabelDefinition:
    ld = LabelDefinition(
        name=name,
        description=f"desc for {name}",
        mode="single",
        phase=phase,
        is_active=True,
    )
    session.add(ld)
    session.commit()
    session.refresh(ld)
    return ld


def _add(
    session: Session,
    label_id: int,
    chatlog_id: int,
    msg_idx: int,
    value: str,
    *,
    applied_by: str = "human",
    confidence: float | None = None,
    ai_value_at_review: str | None = None,
    ai_confidence_at_review: float | None = None,
    created_at: datetime | None = None,
) -> None:
    session.add(
        LabelApplication(
            label_id=label_id,
            chatlog_id=chatlog_id,
            message_index=msg_idx,
            applied_by=applied_by,
            value=value,
            confidence=confidence,
            ai_value_at_review=ai_value_at_review,
            ai_confidence_at_review=ai_confidence_at_review,
            created_at=created_at or datetime.utcnow(),
        )
    )
    session.commit()


def test_cohort_empty(client):
    r = client.get("/api/analysis/single-label/cohort")
    assert r.status_code == 200
    assert r.json() == {"runs": []}


def test_cohort_with_one_run_no_decisions(client, session):
    _make_run(session, "help-seeking")
    rows = client.get("/api/analysis/single-label/cohort").json()["runs"]
    assert len(rows) == 1
    row = rows[0]
    assert row["label_name"] == "help-seeking"
    assert row["yes_count"] == 0
    assert row["no_count"] == 0
    assert row["yes_pct"] == 0
    assert row["disagreement_pct"] is None
    assert row["overlap_count"] == 0
    assert row["weekly_sparkline"] == []


def test_cohort_with_reviewed_ai_predictions(client, session):
    """Overlap = human-decided rows that carry an AI snapshot
    (set by decision_service when a human reviews an AI prediction)."""
    ld = _make_run(session, "help-seeking")
    # 5 reviewed rows where human KEPT the AI's "yes" — agreement
    for i in range(5):
        _add(
            session, ld.id, 1, i, "yes",
            ai_value_at_review="yes", ai_confidence_at_review=0.9,
        )
    # 1 reviewed row where human FLIPPED AI's "yes" to "no" — disagreement
    _add(
        session, ld.id, 1, 100, "no",
        ai_value_at_review="yes", ai_confidence_at_review=0.6,
    )
    # 4 fresh human "no" decisions (never AI-touched) — not in overlap
    for i in range(4):
        _add(session, ld.id, 1, i + 200, "no")

    row = client.get("/api/analysis/single-label/cohort").json()["runs"][0]
    assert row["yes_count"] == 5            # five "yes" humans (kept-AI)
    assert row["no_count"] == 5             # one flipped-from-AI + four fresh
    assert row["yes_pct"] == 50             # 5/10
    assert row["overlap_count"] == 6        # only the snapshot-bearing rows
    assert row["disagreement_pct"] == 17    # 1 disagreement / 6 reviewed → 16.67% → 17


def test_cohort_includes_weekly_sparkline(client, session):
    ld = _make_run(session, "help-seeking")
    base = datetime(2026, 4, 6, 10, 0, 0)  # a Monday
    # Week 1: 3 yes / 1 no  → 75%
    for i in range(3):
        _add(session, ld.id, 1, i, "yes", created_at=base + timedelta(hours=i))
    _add(session, ld.id, 2, 0, "no", created_at=base + timedelta(hours=4))
    # Week 2: 1 yes / 1 no → 50%
    base2 = base + timedelta(days=7)
    _add(session, ld.id, 3, 0, "yes", created_at=base2)
    _add(session, ld.id, 4, 0, "no", created_at=base2 + timedelta(hours=2))

    row = client.get("/api/analysis/single-label/cohort").json()["runs"][0]
    assert row["weekly_sparkline"] == [75, 50]


def test_cohort_archived_run_is_excluded(client, session):
    ld = _make_run(session, "help-seeking")
    ld.archived_at = datetime.utcnow()
    session.add(ld)
    session.commit()
    assert client.get("/api/analysis/single-label/cohort").json() == {"runs": []}


def test_cohort_excludes_multi_label_runs(client, session):
    multi = LabelDefinition(name="confusion", mode="multi", phase="labeling", is_active=True)
    session.add(multi)
    session.commit()
    assert client.get("/api/analysis/single-label/cohort").json() == {"runs": []}
