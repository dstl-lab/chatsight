from datetime import datetime, timedelta

from sqlmodel import Session

from models import (
    AssignmentMapping,
    LabelApplication,
    LabelDefinition,
    MessageCache,
)


def _make_run(session: Session, name: str = "help-seeking") -> int:
    ld = LabelDefinition(
        name=name,
        description=f"desc for {name}",
        mode="single",
        phase="reviewing",
        is_active=True,
    )
    session.add(ld)
    session.commit()
    session.refresh(ld)
    return ld.id


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


def test_run_detail_404_for_missing(client):
    r = client.get("/api/analysis/single-label/runs/99999")
    assert r.status_code == 404


def test_run_detail_404_for_multi_label(client, session):
    multi = LabelDefinition(name="x", mode="multi", phase="labeling", is_active=True)
    session.add(multi)
    session.commit()
    session.refresh(multi)
    r = client.get(f"/api/analysis/single-label/runs/{multi.id}")
    assert r.status_code == 404


def test_run_detail_histogram_bins_combine_pending_and_reviewed(client, session):
    """Histogram should reflect ALL AI predictions for the run, whether still
    pending (applied_by='ai') or already reviewed (snapshot on a human row)."""
    rid = _make_run(session)
    # 5 pending AI predictions across bins 0, 2, 4, 6, 8
    for i, c in enumerate([0.05, 0.25, 0.45, 0.65, 0.85]):
        _add(
            session, rid, 1, i, "yes" if c >= 0.5 else "no",
            applied_by="ai", confidence=c,
        )
    # 3 reviewed-human rows, AI snapshots in bins 1, 3, 9
    _add(session, rid, 2, 0, "yes", ai_value_at_review="yes", ai_confidence_at_review=0.15)
    _add(session, rid, 2, 1, "no",  ai_value_at_review="no",  ai_confidence_at_review=0.35)
    _add(session, rid, 2, 2, "yes", ai_value_at_review="yes", ai_confidence_at_review=1.0)

    r = client.get(f"/api/analysis/single-label/runs/{rid}")
    bins = r.json()["confidence_histogram"]["bins"]
    assert len(bins) == 10
    # pending bins
    assert bins[0]["count"] == 1 and bins[2]["count"] == 1
    assert bins[4]["count"] == 1 and bins[6]["count"] == 1 and bins[8]["count"] == 1
    # reviewed-snapshot bins
    assert bins[1]["count"] == 1 and bins[3]["count"] == 1
    assert bins[9]["count"] == 1  # 1.0 lands in last bin (inclusive)
    # coverage = total AI views (pending + snapshots)
    assert r.json()["confidence_histogram"]["coverage"]["total_ai"] == 8


def test_run_detail_disagreement_uses_snapshot(client, session):
    rid = _make_run(session)
    # 3 reviewed-yes (kept), 1 reviewed flipped (ai_yes_human_no), 2 reviewed flipped (ai_no_human_yes)
    for i in range(3):
        _add(session, rid, 1, i, "yes", ai_value_at_review="yes", ai_confidence_at_review=0.9)
    _add(session, rid, 2, 0, "no", ai_value_at_review="yes", ai_confidence_at_review=0.6)
    _add(session, rid, 3, 0, "yes", ai_value_at_review="no", ai_confidence_at_review=0.4)
    _add(session, rid, 3, 1, "yes", ai_value_at_review="no", ai_confidence_at_review=0.5)
    # Plus one fresh human (not reviewed) — should be excluded from overlap
    _add(session, rid, 4, 0, "no")

    body = r = client.get(f"/api/analysis/single-label/runs/{rid}").json()
    d = body["disagreement"]
    assert d["overlap_count"] == 6
    assert d["agree"] == 3
    assert d["disagree"] == 3
    assert d["rate"] == 50
    assert d["breakdown"] == {"ai_yes_human_no": 1, "ai_no_human_yes": 2}


def test_run_detail_agreement_by_confidence_buckets(client, session):
    rid = _make_run(session)
    # Bucket .8-1: 3 agreements (all kept yes)
    for i in range(3):
        _add(session, rid, 1, i, "yes", ai_value_at_review="yes", ai_confidence_at_review=0.9)
    # Bucket .4-.6: 1 agree, 1 disagree → 50%
    _add(session, rid, 2, 0, "yes", ai_value_at_review="yes", ai_confidence_at_review=0.55)
    _add(session, rid, 2, 1, "no",  ai_value_at_review="yes", ai_confidence_at_review=0.45)
    # Bucket .0-.2: empty

    buckets = client.get(f"/api/analysis/single-label/runs/{rid}").json()["agreement_by_confidence"]["buckets"]
    assert len(buckets) == 5
    by_lo = {round(b["lo"], 1): b for b in buckets}
    assert by_lo[0.0]["overlap_count"] == 0 and by_lo[0.0]["agreement_rate"] is None
    assert by_lo[0.4]["overlap_count"] == 2 and by_lo[0.4]["agreement_rate"] == 50
    assert by_lo[0.8]["overlap_count"] == 3 and by_lo[0.8]["agreement_rate"] == 100


def test_run_detail_conv_yes_pct(client, session):
    rid = _make_run(session)
    # chat 1: at least one yes → counts as yes-conv
    _add(session, rid, 1, 0, "yes")
    _add(session, rid, 1, 5, "no")
    # chat 2: only nos → not a yes-conv
    _add(session, rid, 2, 0, "no")
    # chat 3: yes → yes-conv
    _add(session, rid, 3, 0, "yes")
    body = client.get(f"/api/analysis/single-label/runs/{rid}").json()
    # 2 of 3 conversations decided contain ≥1 yes
    assert body["run"]["conv_yes_pct"] == 67


def test_run_detail_ai_coverage(client, session):
    rid = _make_run(session)
    # 10 cached messages total
    for i in range(10):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"m{i}"))
    session.commit()
    # 2 pending AI rows + 1 reviewed (with snapshot) = 3 distinct messages touched
    _add(session, rid, 1, 0, "yes", applied_by="ai", confidence=0.9)
    _add(session, rid, 1, 1, "no",  applied_by="ai", confidence=0.2)
    _add(session, rid, 1, 5, "yes", ai_value_at_review="yes", ai_confidence_at_review=0.7)
    # A pure human row (no snapshot) — not "AI touched"
    _add(session, rid, 1, 7, "yes")

    cov = client.get(f"/api/analysis/single-label/runs/{rid}").json()["ai_coverage"]
    assert cov == {"covered": 3, "total": 10, "pct": 30}


def test_run_detail_examples_capped_at_8(client, session):
    rid = _make_run(session)
    # 20 yes humans
    for i in range(20):
        _add(session, rid, 1, i, "yes")
    body = client.get(f"/api/analysis/single-label/runs/{rid}").json()
    assert len(body["examples"]["yes"]) <= 8


def test_run_detail_edge_examples_split_low_conf_and_overruled(client, session):
    rid = _make_run(session)
    # Pending AI low-confidence
    _add(session, rid, 1, 0, "yes", applied_by="ai", confidence=0.5)
    # Reviewed disagree (flipped)
    _add(session, rid, 2, 0, "no", ai_value_at_review="yes", ai_confidence_at_review=0.7)
    # Reviewed agree (NOT edge)
    _add(session, rid, 3, 0, "yes", ai_value_at_review="yes", ai_confidence_at_review=0.9)
    # Pure human (NOT edge)
    _add(session, rid, 4, 0, "no")

    edges = client.get(f"/api/analysis/single-label/runs/{rid}").json()["examples"]["edge"]
    flags = sorted(e["flag"] for e in edges)
    assert flags == ["human_overruled", "low_confidence"]


def test_run_detail_by_assignment_uses_mapping(client, session):
    rid = _make_run(session)
    am = AssignmentMapping(pattern="lab1", name="Lab 1")
    session.add(am)
    session.commit()
    session.refresh(am)
    session.add(MessageCache(chatlog_id=1, message_index=0, message_text="x", assignment_id=am.id))
    session.add(MessageCache(chatlog_id=1, message_index=1, message_text="y", assignment_id=am.id))
    session.commit()
    _add(session, rid, 1, 0, "yes")
    _add(session, rid, 1, 1, "no")
    _add(session, rid, 2, 0, "yes")  # no assignment mapping → "Unassigned"

    by_assn = client.get(f"/api/analysis/single-label/runs/{rid}").json()["by_assignment"]
    by_key = {r["key"]: r for r in by_assn}
    assert by_key["Lab 1"] == {"key": "Lab 1", "yes": 1, "no": 1, "yes_pct": 50}
    assert by_key["Unassigned"]["yes_pct"] == 100


def test_run_detail_by_hour_of_day(client, session):
    """Hour-of-day buckets reflect MessageCache.created_at after conversion to
    the analysis timezone (default America/Los_Angeles). UTC 18:00 = PST 10:00."""
    rid = _make_run(session)
    # cache rows with timestamps in UTC
    session.add(
        MessageCache(
            chatlog_id=1, message_index=0, message_text="m0",
            created_at=datetime(2026, 5, 1, 18, 0, 0),  # 10am PT, summer DST: 11am PT, winter: 10am PT — assume PT 10 or 11
        )
    )
    session.add(
        MessageCache(
            chatlog_id=2, message_index=0, message_text="m2",
            created_at=datetime(2026, 5, 1, 19, 30, 0),  # ~11/12 PT
        )
    )
    session.commit()
    _add(session, rid, 1, 0, "yes")
    _add(session, rid, 2, 0, "no")

    body = client.get(f"/api/analysis/single-label/runs/{rid}").json()
    by_hour = body["by_hour_of_day"]
    assert len(by_hour) == 24
    # exactly one yes and one no land somewhere in the array
    total_yes = sum(b["yes"] for b in by_hour)
    total_no = sum(b["no"] for b in by_hour)
    assert total_yes == 1 and total_no == 1


def test_run_detail_by_hour_of_day_excludes_rows_without_timestamp(client, session):
    """Messages whose MessageCache row lacks created_at are excluded from
    the hour-of-day denominator."""
    rid = _make_run(session)
    # no MessageCache row at all → created_at lookup miss
    _add(session, rid, 9, 0, "yes")
    body = client.get(f"/api/analysis/single-label/runs/{rid}").json()
    assert all(b["yes"] == 0 and b["no"] == 0 for b in body["by_hour_of_day"])


def test_run_detail_by_conversation_depth_bucketing(client, session):
    """Buckets: short ≤ 5, mid 6–15, long 16+. Conversation length from
    MAX(message_index) + 1 of cached rows for that chatlog."""
    rid = _make_run(session)
    # chat 1: 5-message conversation (indices 0-4) → short bucket
    for i in range(5):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"m{i}"))
    # chat 2: 10-message conversation → mid
    for i in range(10):
        session.add(MessageCache(chatlog_id=2, message_index=i, message_text=f"m{i}"))
    # chat 3: 20-message conversation → long
    for i in range(20):
        session.add(MessageCache(chatlog_id=3, message_index=i, message_text=f"m{i}"))
    session.commit()
    _add(session, rid, 1, 0, "yes")
    _add(session, rid, 2, 0, "yes")
    _add(session, rid, 2, 1, "no")
    _add(session, rid, 3, 0, "no")

    body = client.get(f"/api/analysis/single-label/runs/{rid}").json()
    by_depth = {r["bucket"]: r for r in body["by_conversation_depth"]}
    assert by_depth["short"] == {"bucket": "short", "yes": 1, "no": 0, "yes_pct": 100}
    assert by_depth["mid"]   == {"bucket": "mid",   "yes": 1, "no": 1, "yes_pct": 50}
    assert by_depth["long"]  == {"bucket": "long",  "yes": 0, "no": 1, "yes_pct": 0}


def test_run_detail_no_weekly_field(client, session):
    """The legacy `weekly` time series is no longer in the run-detail payload."""
    rid = _make_run(session)
    _add(session, rid, 1, 0, "yes")
    body = client.get(f"/api/analysis/single-label/runs/{rid}").json()
    assert "weekly" not in body
