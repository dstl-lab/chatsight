"""Tests for decision_service: record_decision, undo, readiness math."""
import pytest
from sqlmodel import select

import decision_service
from models import LabelApplication, LabelDefinition, MessageCache


def _make_label(session, name="help"):
    label = LabelDefinition(name=name, mode="single", phase="labeling", is_active=True)
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


def _make_messages(session, count=10, conversations=2):
    per_conv = count // conversations
    for c in range(conversations):
        for i in range(per_conv):
            session.add(MessageCache(
                chatlog_id=100 + c,
                message_index=i,
                message_text=f"conv {c} msg {i}",
            ))
    session.commit()


def test_record_decision_creates_row(session):
    label = _make_label(session)
    decision_service.record_decision(session, label.id, 100, 0, "yes")
    rows = session.exec(select(LabelApplication)).all()
    assert len(rows) == 1
    assert rows[0].value == "yes"
    assert rows[0].applied_by == "human"
    assert rows[0].confidence == 1.0


def test_record_decision_is_idempotent(session):
    label = _make_label(session)
    decision_service.record_decision(session, label.id, 100, 0, "yes")
    decision_service.record_decision(session, label.id, 100, 0, "no")
    rows = session.exec(select(LabelApplication)).all()
    assert len(rows) == 1
    assert rows[0].value == "no"


def test_record_decision_rejects_invalid_value(session):
    label = _make_label(session)
    with pytest.raises(ValueError):
        decision_service.record_decision(session, label.id, 100, 0, "maybe")


def test_undo_last_removes_most_recent(session):
    label = _make_label(session)
    decision_service.record_decision(session, label.id, 100, 0, "yes")
    decision_service.record_decision(session, label.id, 100, 1, "no")
    snapshot = decision_service.undo_last_decision(session, label.id)
    assert snapshot is not None
    assert snapshot.message_index == 1
    rows = session.exec(select(LabelApplication)).all()
    assert len(rows) == 1
    assert rows[0].message_index == 0


def test_undo_last_returns_none_when_empty(session):
    label = _make_label(session)
    assert decision_service.undo_last_decision(session, label.id) is None


def test_readiness_gray_when_no_yes_or_no(session):
    label = _make_label(session)
    _make_messages(session)
    decision_service.record_decision(session, label.id, 100, 0, "yes")
    state = decision_service.compute_readiness(session, label.id)
    assert state["tier"] == "gray"  # no "no" yet
    assert state["yes_count"] == 1


def test_readiness_amber_with_few_conversations(session):
    label = _make_label(session)
    _make_messages(session, count=20, conversations=3)
    decision_service.record_decision(session, label.id, 100, 0, "yes")
    decision_service.record_decision(session, label.id, 100, 1, "no")
    state = decision_service.compute_readiness(session, label.id)
    assert state["tier"] == "amber"
    assert state["conversations_walked"] == 1


def test_readiness_green_with_5_conversations_and_balance(session):
    label = _make_label(session)
    _make_messages(session, count=50, conversations=10)
    for c in range(5):
        decision_service.record_decision(session, label.id, 100 + c, 0, "yes")
        decision_service.record_decision(session, label.id, 100 + c, 1, "no")
    state = decision_service.compute_readiness(session, label.id)
    assert state["tier"] == "green"
    assert state["conversations_walked"] == 5


def test_label_counts_excludes_ai_rows(session):
    label = _make_label(session)
    decision_service.record_decision(session, label.id, 100, 0, "yes")
    # Add an AI row to make sure it doesn't show up in human counts
    ai_row = LabelApplication(
        label_id=label.id,
        chatlog_id=100,
        message_index=5,
        applied_by="ai",
        confidence=0.8,
        value="yes",
    )
    session.add(ai_row)
    session.commit()
    yes, no, skip, walked = decision_service.label_counts(session, label.id)
    assert yes == 1
    assert no == 0
    assert skip == 0
    assert walked == 1


def test_skip_conversation_marks_all_undecided_messages(session):
    label = _make_label(session)
    _make_messages(session, count=10, conversations=2)  # 5 messages each in conv 100, 101

    # Pre-decide one message in conv 100 to ensure it's preserved
    decision_service.record_decision(session, label.id, 100, 0, "yes")

    skipped = decision_service.skip_conversation(session, label.id, 100)
    assert skipped == 4  # 5 messages, 1 already decided

    rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == label.id,
            LabelApplication.chatlog_id == 100,
        )
    ).all()
    # 1 yes + 4 skip
    assert len(rows) == 5
    by_value = sorted(r.value for r in rows)
    assert by_value == ["skip", "skip", "skip", "skip", "yes"]


def test_skip_conversation_zero_when_already_decided(session):
    label = _make_label(session)
    _make_messages(session, count=4, conversations=1)  # 4 messages in conv 100
    for i in range(4):
        decision_service.record_decision(session, label.id, 100, i, "yes")
    skipped = decision_service.skip_conversation(session, label.id, 100)
    assert skipped == 0
