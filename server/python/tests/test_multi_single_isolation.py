"""Phase-1 isolation tests: multi-label aggregations and the multi-label queue
must NOT count or be affected by single-label /run rows that share the same
LabelApplication table. Symmetric write guards must reject mode/value mismatches.
The startup cleanup migration must remove polluted rows on multi-mode labels.
"""
from sqlalchemy import text
from sqlmodel import select

import decision_service
from database import _cleanup_polluted_multi_label_rows
from models import LabelApplication, LabelDefinition, MessageCache


def _make_multi_label(session, name="copy and paste"):
    lbl = LabelDefinition(name=name, mode="multi")
    session.add(lbl)
    session.commit()
    session.refresh(lbl)
    return lbl


def _make_single_label(session, name="seeking answer"):
    lbl = LabelDefinition(name=name, mode="single", phase="labeling", is_active=True)
    session.add(lbl)
    session.commit()
    session.refresh(lbl)
    return lbl


def _seed_messages(session, n=5):
    for i in range(n):
        session.add(MessageCache(
            chatlog_id=100,
            message_index=i,
            message_text=f"msg {i}",
        ))
    session.commit()


# ── Counts isolation ─────────────────────────────────────────────────────────

def test_labels_count_excludes_single_mode_rows(client, session):
    multi = _make_multi_label(session, "copy and paste")
    single = _make_single_label(session, "seeking answer")

    # Real multi-label application
    session.add(LabelApplication(label_id=multi.id, chatlog_id=1, message_index=0, applied_by="human"))
    # Single-mode "yes" and "no" decisions on the SAME message — different label
    session.add(LabelApplication(label_id=single.id, chatlog_id=1, message_index=0, applied_by="human", value="yes"))
    session.add(LabelApplication(label_id=single.id, chatlog_id=1, message_index=1, applied_by="human", value="no"))
    # Polluted: a stray value-bearing row on a multi-mode label (pre-fix data)
    session.add(LabelApplication(label_id=multi.id, chatlog_id=1, message_index=2, applied_by="human", value="no"))
    session.commit()

    labels = client.get("/api/labels").json()
    by_name = {lbl["name"]: lbl["count"] for lbl in labels}
    # Only the value=NULL row counts toward the multi-mode label.
    assert by_name["copy and paste"] == 1
    # Single-mode labels are not exposed by /api/labels.
    assert "seeking answer" not in by_name


def test_analysis_summary_counts_multi_only(client, session):
    multi = _make_multi_label(session, "validation")
    single = _make_single_label(session, "debugging")

    # 3 multi-label applications
    for i in range(3):
        session.add(LabelApplication(label_id=multi.id, chatlog_id=1, message_index=i, applied_by="human"))
    # 100 single-mode "yes" decisions on a different label — must NOT bleed into
    # the multi-label "validation" count or appear in /analysis at all.
    for i in range(100):
        session.add(LabelApplication(label_id=single.id, chatlog_id=2, message_index=i, applied_by="human", value="yes"))
    session.commit()

    summary = client.get("/api/analysis/summary").json()
    assert summary["label_counts"].get("validation") == 3
    assert "debugging" not in summary["label_counts"]


# ── Queue exclusion ──────────────────────────────────────────────────────────

def test_queue_does_not_exclude_single_mode_decisions(client, session):
    multi = _make_multi_label(session)
    single = _make_single_label(session)
    _seed_messages(session, n=3)

    # The single-label /run flow has decided "no" on every cached message.
    for i in range(3):
        session.add(LabelApplication(
            label_id=single.id, chatlog_id=100, message_index=i,
            applied_by="human", value="no",
        ))
    session.commit()

    # Multi-label queue should still surface every message — /run touches do
    # not remove a message from the multi-label discovery queue.
    items = client.get("/api/queue?limit=20").json()
    assert len(items) == 3


def test_queue_excludes_only_multi_label_applications(client, session):
    multi = _make_multi_label(session)
    _seed_messages(session, n=3)

    # Apply a true multi-label application to message_index=1 only.
    session.add(LabelApplication(
        label_id=multi.id, chatlog_id=100, message_index=1, applied_by="human",
    ))
    session.commit()

    items = client.get("/api/queue?limit=20").json()
    indices = sorted(it["message_index"] for it in items)
    assert indices == [0, 2]


def test_queue_stats_labeled_count_is_multi_only(client, session):
    multi = _make_multi_label(session)
    single = _make_single_label(session)
    _seed_messages(session, n=5)

    # 1 real multi-label, 5 single-label "yes" — only the 1 should count.
    session.add(LabelApplication(
        label_id=multi.id, chatlog_id=100, message_index=0, applied_by="human",
    ))
    for i in range(5):
        session.add(LabelApplication(
            label_id=single.id, chatlog_id=100, message_index=i,
            applied_by="human", value="yes",
        ))
    session.commit()

    stats = client.get("/api/queue/stats").json()
    assert stats["labeled_count"] == 1
    assert stats["total_messages"] == 5


# ── Write-side guards ────────────────────────────────────────────────────────

def test_apply_label_rejects_single_mode_label(client, session):
    single = _make_single_label(session)
    r = client.post("/api/queue/apply", json={
        "label_id": single.id, "chatlog_id": 1, "message_index": 0,
    })
    assert r.status_code == 409
    assert "expected 'multi'" in r.json()["detail"]


def test_apply_batch_rejects_single_mode_label(client, session):
    multi = _make_multi_label(session)
    single = _make_single_label(session)
    r = client.post("/api/queue/apply-batch", json={
        "assignments": {
            "1:0": multi.id,
            "1:1": single.id,  # mode mismatch — whole batch fails
        }
    })
    assert r.status_code == 409
    # Nothing was written.
    rows = session.exec(select(LabelApplication)).all()
    assert rows == []


def test_record_decision_rejects_multi_mode_label(session):
    multi = _make_multi_label(session)
    import pytest
    with pytest.raises(ValueError, match="expected 'single'"):
        decision_service.record_decision(session, multi.id, 1, 0, "yes")


def test_skip_conversation_rejects_multi_mode_label(session):
    multi = _make_multi_label(session)
    import pytest
    with pytest.raises(ValueError, match="expected 'single'"):
        decision_service.skip_conversation(session, multi.id, 1)


# ── Cleanup migration ────────────────────────────────────────────────────────

def test_cleanup_removes_value_rows_on_multi_labels_only(session):
    multi = _make_multi_label(session, "copy and paste")
    single = _make_single_label(session, "seeking answer")

    # Polluted: 4 value rows on the multi-mode label.
    for i in range(4):
        session.add(LabelApplication(
            label_id=multi.id, chatlog_id=1, message_index=i,
            applied_by="ai", value=("yes" if i % 2 else "no"),
        ))
    # Legit multi-label NULL row on the multi-mode label — must survive.
    session.add(LabelApplication(
        label_id=multi.id, chatlog_id=1, message_index=10, applied_by="human",
    ))
    # Legit single-mode rows on the single-mode label — must survive.
    for i in range(3):
        session.add(LabelApplication(
            label_id=single.id, chatlog_id=1, message_index=i,
            applied_by="human", value="yes",
        ))
    session.commit()

    conn = session.connection()
    _cleanup_polluted_multi_label_rows(conn, text)
    session.commit()

    rows = session.exec(select(LabelApplication)).all()
    # 1 NULL on multi-mode + 3 yes on single-mode = 4 total.
    assert len(rows) == 4
    assert all(
        (r.label_id == multi.id and r.value is None) or
        (r.label_id == single.id and r.value == "yes")
        for r in rows
    )


def test_cleanup_is_idempotent(session):
    multi = _make_multi_label(session)
    session.add(LabelApplication(
        label_id=multi.id, chatlog_id=1, message_index=0,
        applied_by="ai", value="yes",
    ))
    session.commit()

    # Two runs, each with a fresh connection — production behavior.
    _cleanup_polluted_multi_label_rows(session.connection(), text)
    session.commit()
    _cleanup_polluted_multi_label_rows(session.connection(), text)
    session.commit()

    assert session.exec(select(LabelApplication)).all() == []
