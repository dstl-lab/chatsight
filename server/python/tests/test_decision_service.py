import pytest
from sqlmodel import Session, select
from models import LabelDefinition, LabelApplication, MessageCache
from decision_service import (
    decide,
    undo_last,
    readiness,
    activate_label,
    close_label,
)


def _label(session: Session, name="L") -> LabelDefinition:
    label = LabelDefinition(name=name)
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


def test_activate_makes_label_active_and_deactivates_others(session: Session):
    a = _label(session, "A")
    b = _label(session, "B")
    activate_label(session, label_id=a.id)
    activate_label(session, label_id=b.id)
    session.refresh(a)
    session.refresh(b)
    assert a.is_active is False
    assert b.is_active is True


def test_decide_writes_application_with_value(session: Session):
    label = _label(session)
    decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    row = session.exec(select(LabelApplication)).first()
    assert row.value == "yes"
    assert row.applied_by == "human"


def test_decide_rejects_invalid_value(session: Session):
    label = _label(session)
    with pytest.raises(ValueError):
        decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="maybe")


def test_decide_idempotent_overwrites_existing(session: Session):
    label = _label(session)
    decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="no")
    rows = session.exec(select(LabelApplication)).all()
    assert len(rows) == 1
    assert rows[0].value == "no"


def test_undo_removes_most_recent_decision(session: Session):
    label = _label(session)
    decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    decide(session, label_id=label.id, chatlog_id=1, message_index=1, value="no")
    removed = undo_last(session, label_id=label.id)
    assert removed == {"chatlog_id": 1, "message_index": 1}
    rows = session.exec(select(LabelApplication)).all()
    assert len(rows) == 1
    assert rows[0].message_index == 0


def test_undo_returns_none_when_no_decisions(session: Session):
    label = _label(session)
    assert undo_last(session, label_id=label.id) is None


def test_readiness_counts(session: Session):
    label = _label(session)
    session.add(MessageCache(chatlog_id=1, message_index=0, message_text="a"))
    session.add(MessageCache(chatlog_id=1, message_index=1, message_text="b"))
    session.add(MessageCache(chatlog_id=2, message_index=0, message_text="c"))
    session.commit()
    decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    decide(session, label_id=label.id, chatlog_id=1, message_index=1, value="no")
    decide(session, label_id=label.id, chatlog_id=2, message_index=0, value="skip")
    r = readiness(session, label_id=label.id)
    assert r["yes_count"] == 1
    assert r["no_count"] == 1
    assert r["skip_count"] == 1
    assert r["conversations_walked"] == 2  # 1 fully done, 2 fully done (one msg)
    assert r["total_conversations"] == 2
    assert r["ready"] is True


def test_close_label_sets_phase_complete(session: Session):
    label = _label(session)
    activate_label(session, label_id=label.id)
    close_label(session, label_id=label.id)
    session.refresh(label)
    assert label.phase == "complete"
    assert label.is_active is False
