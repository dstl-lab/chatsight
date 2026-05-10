"""Phase-2 tests: POST /api/labels/{multi_id}/promote creates a paired
mode='single' LabelDefinition, pre-seeds it with 'yes' decisions, links it
back via paired_label_id, and is idempotent. /api/labels and
/api/analysis/summary surface the paired summary alongside the multi count.
"""
import pytest
from datetime import datetime
from sqlalchemy import text
from sqlmodel import select

from database import _cleanup_polluted_multi_label_rows
from models import LabelApplication, LabelDefinition


def _make_multi(session, name="validation", description=None):
    lbl = LabelDefinition(name=name, description=description, mode="multi")
    session.add(lbl)
    session.commit()
    session.refresh(lbl)
    return lbl


def _seed_multi_apps(session, label_id, n=5, chatlog_id=100):
    for i in range(n):
        session.add(LabelApplication(
            label_id=label_id, chatlog_id=chatlog_id, message_index=i,
            applied_by="human",
        ))
    session.commit()


# ── Happy path ───────────────────────────────────────────────────────────────

def test_promote_creates_paired_single_with_preseed(client, session):
    multi = _make_multi(session, "validation", description="Concept check")
    _seed_multi_apps(session, multi.id, n=5)

    r = client.post(f"/api/labels/{multi.id}/promote")
    assert r.status_code == 200
    paired = r.json()
    assert paired["mode"] == "single"
    assert paired["phase"] == "queued"
    assert paired["name"] == "validation"
    assert paired["yes_count"] == 5

    # DB-level checks: paired link, multi rows untouched, pre-seed rows present.
    paired_def = session.get(LabelDefinition, paired["id"])
    assert paired_def.paired_label_id == multi.id
    assert paired_def.description == "Concept check"

    multi_rows = session.exec(
        select(LabelApplication).where(LabelApplication.label_id == multi.id)
    ).all()
    assert len(multi_rows) == 5
    assert all(r.value is None for r in multi_rows)

    paired_rows = session.exec(
        select(LabelApplication).where(LabelApplication.label_id == paired_def.id)
    ).all()
    assert len(paired_rows) == 5
    assert all(r.value == "yes" and r.applied_by == "human" for r in paired_rows)


def test_promote_assigns_queue_position_at_end(client, session):
    multi_a = _make_multi(session, "alpha")
    multi_b = _make_multi(session, "beta")
    # An existing queued single from an earlier flow.
    existing = LabelDefinition(
        name="prior", mode="single", phase="queued", queue_position=0,
    )
    session.add(existing)
    session.commit()

    pa = client.post(f"/api/labels/{multi_a.id}/promote").json()
    pb = client.post(f"/api/labels/{multi_b.id}/promote").json()
    assert pa["queue_position"] == 1
    assert pb["queue_position"] == 2


# ── Idempotency ──────────────────────────────────────────────────────────────

def test_promote_is_idempotent_when_pair_active(client, session):
    multi = _make_multi(session)
    _seed_multi_apps(session, multi.id, n=3)

    r1 = client.post(f"/api/labels/{multi.id}/promote").json()
    r2 = client.post(f"/api/labels/{multi.id}/promote").json()
    assert r1["id"] == r2["id"]

    # Pre-seed shouldn't double up.
    paired_rows = session.exec(
        select(LabelApplication).where(LabelApplication.label_id == r1["id"])
    ).all()
    assert len(paired_rows) == 3


def test_promote_creates_fresh_pair_after_archive(client, session):
    multi = _make_multi(session)
    _seed_multi_apps(session, multi.id, n=2)

    first = client.post(f"/api/labels/{multi.id}/promote").json()
    paired_def = session.get(LabelDefinition, first["id"])
    paired_def.archived_at = datetime.utcnow()
    session.add(paired_def)
    session.commit()

    second = client.post(f"/api/labels/{multi.id}/promote").json()
    assert second["id"] != first["id"]
    assert second["yes_count"] == 2  # pre-seed re-runs


# ── Guards ───────────────────────────────────────────────────────────────────

def test_promote_rejects_single_mode_label(client, session):
    single = LabelDefinition(name="seeking answer", mode="single", phase="labeling", is_active=True)
    session.add(single)
    session.commit()
    session.refresh(single)

    r = client.post(f"/api/labels/{single.id}/promote")
    assert r.status_code == 409
    assert "expected 'multi'" in r.json()["detail"]


def test_promote_rejects_archived_multi(client, session):
    multi = _make_multi(session)
    multi.archived_at = datetime.utcnow()
    session.add(multi)
    session.commit()

    r = client.post(f"/api/labels/{multi.id}/promote")
    assert r.status_code == 409
    assert "archived" in r.json()["detail"]


def test_promote_404_when_multi_missing(client):
    r = client.post("/api/labels/999999/promote")
    assert r.status_code == 404


# ── Composed reads ───────────────────────────────────────────────────────────

def test_labels_endpoint_surfaces_paired_summary(client, session):
    multi = _make_multi(session, "validation")
    _seed_multi_apps(session, multi.id, n=4)
    client.post(f"/api/labels/{multi.id}/promote")

    labels = client.get("/api/labels").json()
    by_name = {lbl["name"]: lbl for lbl in labels}
    card = by_name["validation"]
    # Multi count stays multi-only (Phase 1 semantics).
    assert card["count"] == 4
    assert card["paired_label_id"] is not None
    assert card["paired_summary"]["yes_count"] == 4
    assert card["paired_summary"]["no_count"] == 0
    assert card["paired_summary"]["phase"] == "queued"


def test_labels_endpoint_paired_summary_absent_when_no_pair(client, session):
    multi = _make_multi(session, "validation")
    _seed_multi_apps(session, multi.id, n=2)

    card = client.get("/api/labels").json()[0]
    assert card["paired_label_id"] is None
    assert card["paired_summary"] is None


def test_analysis_summary_includes_paired_label_counts(client, session):
    multi = _make_multi(session, "validation")
    _seed_multi_apps(session, multi.id, n=3)
    promoted = client.post(f"/api/labels/{multi.id}/promote").json()

    # Add a paired-single "no" decision to verify it's broken out properly.
    session.add(LabelApplication(
        label_id=promoted["id"], chatlog_id=100, message_index=99,
        applied_by="human", value="no",
    ))
    session.commit()

    summary = client.get("/api/analysis/summary").json()
    assert "paired_label_counts" in summary
    plc = summary["paired_label_counts"]
    assert "validation" in plc
    assert plc["validation"]["yes"] == 3
    assert plc["validation"]["no"] == 1
    assert plc["validation"]["phase"] == "queued"


# ── Cleanup migration safety ─────────────────────────────────────────────────

def test_preseed_yes_rows_survive_cleanup_migration(client, session):
    multi = _make_multi(session)
    _seed_multi_apps(session, multi.id, n=4)
    promoted = client.post(f"/api/labels/{multi.id}/promote").json()

    # Phase-1 cleanup must not touch the paired single's rows (mode='single').
    _cleanup_polluted_multi_label_rows(session.connection(), text)
    session.commit()

    paired_rows = session.exec(
        select(LabelApplication).where(LabelApplication.label_id == promoted["id"])
    ).all()
    assert len(paired_rows) == 4
    assert all(r.value == "yes" for r in paired_rows)
