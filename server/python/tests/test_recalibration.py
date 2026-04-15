# server/python/tests/test_recalibration.py
from datetime import datetime, timedelta
from models import MessageCache, LabelDefinition, LabelApplication, LabelingSession, RecalibrationEvent


def _seed_session(session):
    """Create a labeling session and return it."""
    ls = LabelingSession(started_at=datetime.utcnow(), last_active=datetime.utcnow())
    session.add(ls)
    session.commit()
    session.refresh(ls)
    return ls


def _seed_labels(session, count=3):
    """Create labels and return them."""
    labels = []
    for i in range(count):
        lbl = LabelDefinition(name=f"Label {i}", sort_order=i)
        session.add(lbl)
        session.commit()
        session.refresh(lbl)
        labels.append(lbl)
    return labels


def _seed_messages(session, count=10):
    """Create cached messages and return them."""
    msgs = []
    for i in range(count):
        msg = MessageCache(
            chatlog_id=100 + i, message_index=0,
            message_text=f"Test message {i}",
        )
        session.add(msg)
        msgs.append(msg)
    session.commit()
    return msgs


def _apply_label(session, chatlog_id, message_index, label_id, age_hours=0):
    """Apply a label with optional age offset."""
    app = LabelApplication(
        chatlog_id=chatlog_id, message_index=message_index,
        label_id=label_id, applied_by="human",
        created_at=datetime.utcnow() - timedelta(hours=age_hours),
    )
    session.add(app)
    session.commit()
    return app


# ── GET /api/session/recalibration ─────────────────────────────────────────

def test_recalibration_returns_null_without_session(client):
    r = client.get("/api/session/recalibration")
    assert r.status_code == 200
    assert r.json() is None


def test_recalibration_returns_null_when_interval_not_reached(client, session):
    ls = _seed_session(session)
    labels = _seed_labels(session, 2)
    msgs = _seed_messages(session, 6)
    # 6 labeled messages (above min threshold of 5), but need 10 for first trigger
    for i, msg in enumerate(msgs):
        _apply_label(session, msg.chatlog_id, msg.message_index, labels[i % 2].id)
    r = client.get("/api/session/recalibration")
    assert r.status_code == 200
    assert r.json() is None


def test_recalibration_returns_message_when_interval_reached(client, session):
    # Session started 24 hours ago so all labels are "after" session start
    ls = LabelingSession(
        started_at=datetime.utcnow() - timedelta(hours=24),
        last_active=datetime.utcnow(),
    )
    session.add(ls)
    session.commit()
    session.refresh(ls)
    labels = _seed_labels(session, 2)
    msgs = _seed_messages(session, 12)
    # Label 12 messages — exceeds base interval of 10
    for i, msg in enumerate(msgs):
        _apply_label(session, msg.chatlog_id, msg.message_index, labels[i % 2].id, age_hours=12 - i)
    r = client.get("/api/session/recalibration")
    assert r.status_code == 200
    data = r.json()
    assert data is not None
    assert "chatlog_id" in data
    assert "message_index" in data
    assert "message_text" in data
    assert "original_label_ids" in data
    assert isinstance(data["original_label_ids"], list)


def test_recalibration_returns_null_after_recent_recalibration(client, session):
    ls = _seed_session(session)
    labels = _seed_labels(session, 2)
    msgs = _seed_messages(session, 12)
    for i, msg in enumerate(msgs):
        _apply_label(session, msg.chatlog_id, msg.message_index, labels[i % 2].id)

    # Save a recalibration event (simulating one just happened)
    event = RecalibrationEvent(
        chatlog_id=msgs[0].chatlog_id, message_index=0,
        original_label_ids="[1]", relabel_ids="[1]", final_label_ids="[1]",
        matched=True, session_id=ls.id,
        created_at=datetime.utcnow(),
    )
    session.add(event)
    session.commit()

    # Now the count since last recalibration is 0, so no new recalibration
    r = client.get("/api/session/recalibration")
    assert r.status_code == 200
    assert r.json() is None


# ── Sampling (cooldown, stratification, age weighting) ───────────────────

def test_recalibration_excludes_messages_in_cooldown(client, session):
    """A message recalibrated within the cooldown window must not be picked again."""
    ls = LabelingSession(
        started_at=datetime.utcnow() - timedelta(hours=48),
        last_active=datetime.utcnow(),
    )
    session.add(ls)
    session.commit()
    session.refresh(ls)

    labels = _seed_labels(session, 2)
    msgs = _seed_messages(session, 12)

    # Record a prior recalibration event for msgs[0] before any labels exist.
    event = RecalibrationEvent(
        chatlog_id=msgs[0].chatlog_id, message_index=0,
        original_label_ids="[1]", relabel_ids="[1]", final_label_ids="[1]",
        matched=True, session_id=ls.id,
        created_at=datetime.utcnow() - timedelta(hours=24),
    )
    session.add(event)
    session.commit()

    # Apply 12 distinct-message labels after the event.
    # labeled_since = 12 ≥ interval (10); for msgs[0] since_count = 12 < COOLDOWN (50).
    for i, msg in enumerate(msgs):
        _apply_label(session, msg.chatlog_id, msg.message_index, labels[i % 2].id, age_hours=12 - i)

    r = client.get("/api/session/recalibration")
    assert r.status_code == 200
    data = r.json()
    assert data is not None
    assert data["chatlog_id"] != msgs[0].chatlog_id


def test_recalibration_sampling_weights_by_label_prevalence(client, session, monkeypatch):
    """With no recalibration history, stratified sampling prefers more prevalent labels."""
    import random
    monkeypatch.setattr(
        random, "choices",
        lambda candidates, weights, k=1: [candidates[max(range(len(weights)), key=lambda i: weights[i])]],
    )

    ls = LabelingSession(
        started_at=datetime.utcnow() - timedelta(hours=48),
        last_active=datetime.utcnow(),
    )
    session.add(ls)
    session.commit()
    session.refresh(ls)

    labels = _seed_labels(session, 2)  # label A (id=1), label B (id=2)
    msgs = _seed_messages(session, 11)

    # 10 messages labeled with A, 1 with B. msgs[0] is the oldest label-A msg.
    for i in range(10):
        _apply_label(session, msgs[i].chatlog_id, msgs[i].message_index, labels[0].id, age_hours=24 - i)
    _apply_label(session, msgs[10].chatlog_id, msgs[10].message_index, labels[1].id, age_hours=24)

    r = client.get("/api/session/recalibration")
    assert r.status_code == 200
    data = r.json()
    assert data is not None
    # deficit[A]=10/11, deficit[B]=1/11 → label-A weights dominate label-B
    assert data["chatlog_id"] != msgs[10].chatlog_id
    assert data["original_label_ids"] == [labels[0].id]


def test_recalibration_sampling_weights_by_age(client, session, monkeypatch):
    """With matched label deficits, the oldest message wins the age-weighted tiebreak."""
    import random
    monkeypatch.setattr(
        random, "choices",
        lambda candidates, weights, k=1: [candidates[max(range(len(weights)), key=lambda i: weights[i])]],
    )

    ls = LabelingSession(
        started_at=datetime.utcnow() - timedelta(hours=48),
        last_active=datetime.utcnow(),
    )
    session.add(ls)
    session.commit()
    session.refresh(ls)

    labels = _seed_labels(session, 1)  # single label → deficit identical for all msgs
    msgs = _seed_messages(session, 10)

    # One much older message, nine recent ones
    _apply_label(session, msgs[0].chatlog_id, 0, labels[0].id, age_hours=24)
    for i in range(1, 10):
        _apply_label(session, msgs[i].chatlog_id, 0, labels[0].id, age_hours=0)

    r = client.get("/api/session/recalibration")
    assert r.status_code == 200
    data = r.json()
    assert data is not None
    assert data["chatlog_id"] == msgs[0].chatlog_id


# ── POST /api/session/recalibration ────────────────────────────────────────

def test_save_recalibration_match(client, session):
    _seed_session(session)
    labels = _seed_labels(session, 2)
    msgs = _seed_messages(session, 1)
    _apply_label(session, msgs[0].chatlog_id, 0, labels[0].id)

    r = client.post("/api/session/recalibration", json={
        "chatlog_id": msgs[0].chatlog_id,
        "message_index": 0,
        "original_label_ids": [labels[0].id],
        "relabel_ids": [labels[0].id],
        "final_label_ids": [labels[0].id],
    })
    assert r.status_code == 200
    data = r.json()
    assert data["matched"] is True
    assert data["trend"] in ("improving", "steady", "shifting")


def test_save_recalibration_mismatch_reconciles_labels(client, session):
    _seed_session(session)
    labels = _seed_labels(session, 3)
    msgs = _seed_messages(session, 1)
    _apply_label(session, msgs[0].chatlog_id, 0, labels[0].id)
    _apply_label(session, msgs[0].chatlog_id, 0, labels[1].id)

    # Re-labeled with label 0 and 2 (removed 1, added 2)
    # Final decision: keep label 0 and 2
    r = client.post("/api/session/recalibration", json={
        "chatlog_id": msgs[0].chatlog_id,
        "message_index": 0,
        "original_label_ids": [labels[0].id, labels[1].id],
        "relabel_ids": [labels[0].id, labels[2].id],
        "final_label_ids": [labels[0].id, labels[2].id],
    })
    assert r.status_code == 200
    assert r.json()["matched"] is False

    # Verify labels were reconciled in the database
    from sqlmodel import select
    apps = session.exec(
        select(LabelApplication).where(
            LabelApplication.chatlog_id == msgs[0].chatlog_id,
            LabelApplication.message_index == 0,
        )
    ).all()
    applied_ids = {app.label_id for app in apps}
    assert applied_ids == {labels[0].id, labels[2].id}


# ── GET /api/session/recalibration/stats ───────────────────────────────────

def test_recalibration_stats_empty(client, session):
    _seed_session(session)
    r = client.get("/api/session/recalibration/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["recent_results"] == []
    assert data["trend"] == "steady"
    assert data["total_recalibrations"] == 0
    assert data["current_interval"] == 10  # base interval


def test_recalibration_stats_with_events(client, session):
    ls = _seed_session(session)
    # Add some recalibration events
    for i in range(6):
        event = RecalibrationEvent(
            chatlog_id=100 + i, message_index=0,
            original_label_ids="[1]", relabel_ids="[1]" if i >= 2 else "[2]",
            final_label_ids="[1]", matched=(i >= 2),
            session_id=ls.id,
            created_at=datetime.utcnow() - timedelta(hours=6 - i),
        )
        session.add(event)
    session.commit()

    r = client.get("/api/session/recalibration/stats")
    assert r.status_code == 200
    data = r.json()
    assert len(data["recent_results"]) == 6
    assert data["recent_results"] == [False, False, True, True, True, True]
    assert data["total_recalibrations"] == 6
    assert data["trend"] == "improving"


# ── Adaptive interval ─────────────────────────────────────────────────────

def test_adaptive_interval_increases_with_high_consistency(client, session):
    ls = _seed_session(session)
    # 5 consecutive matches → should increase interval from 10 to 15
    for i in range(5):
        event = RecalibrationEvent(
            chatlog_id=100 + i, message_index=0,
            original_label_ids="[1]", relabel_ids="[1]", final_label_ids="[1]",
            matched=True, session_id=ls.id,
            created_at=datetime.utcnow() - timedelta(hours=5 - i),
        )
        session.add(event)
    session.commit()

    r = client.get("/api/session/recalibration/stats")
    data = r.json()
    assert data["current_interval"] == 15  # increased from 10


def test_adaptive_interval_decreases_with_low_consistency(client, session):
    ls = _seed_session(session)
    # 5 events, only 2 matched (40% < 70%) → should decrease interval from 10 to 5
    for i in range(5):
        matched = i < 2
        event = RecalibrationEvent(
            chatlog_id=100 + i, message_index=0,
            original_label_ids="[1]", relabel_ids="[1]" if matched else "[2]",
            final_label_ids="[1]", matched=matched, session_id=ls.id,
            created_at=datetime.utcnow() - timedelta(hours=5 - i),
        )
        session.add(event)
    session.commit()

    r = client.get("/api/session/recalibration/stats")
    data = r.json()
    assert data["current_interval"] == 5  # decreased from 10
