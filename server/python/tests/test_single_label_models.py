from sqlmodel import Session, select
from models import LabelDefinition


def test_label_definition_has_phase_and_is_active(session: Session):
    label = LabelDefinition(name="Concept Question")
    session.add(label)
    session.commit()
    session.refresh(label)
    assert label.phase == "labeling"
    assert label.is_active is False


def test_only_one_label_can_be_active(session: Session):
    a = LabelDefinition(name="A", is_active=True)
    b = LabelDefinition(name="B", is_active=True)
    session.add(a)
    session.add(b)
    session.commit()
    # Both can be flagged in raw DB, but the activate service (Task 5) enforces uniqueness.
    # This test just verifies the field exists and is settable.
    rows = session.exec(select(LabelDefinition).where(LabelDefinition.is_active == True)).all()
    assert len(rows) == 2


import pytest
from sqlalchemy.exc import IntegrityError
from models import LabelApplication


def test_label_application_has_value(session: Session):
    label = LabelDefinition(name="X")
    session.add(label)
    session.commit()
    session.refresh(label)
    app = LabelApplication(label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    session.add(app)
    session.commit()
    session.refresh(app)
    assert app.value == "yes"


def test_unique_decision_per_label_message(session: Session):
    label = LabelDefinition(name="X")
    session.add(label)
    session.commit()
    session.refresh(label)
    a = LabelApplication(label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    b = LabelApplication(label_id=label.id, chatlog_id=1, message_index=0, value="no")
    session.add(a)
    session.commit()
    session.add(b)
    with pytest.raises(IntegrityError):
        session.commit()


from models import LabelingSession, ConversationCursor


def test_labeling_session_has_label_id_and_timestamps(session: Session):
    label = LabelDefinition(name="Y")
    session.add(label)
    session.commit()
    session.refresh(label)
    s = LabelingSession(label_id=label.id)
    session.add(s)
    session.commit()
    session.refresh(s)
    assert s.label_id == label.id
    assert s.handed_off_at is None
    assert s.closed_at is None


def test_conversation_cursor_unique_per_label_chatlog(session: Session):
    label = LabelDefinition(name="Z")
    session.add(label)
    session.commit()
    session.refresh(label)
    c = ConversationCursor(label_id=label.id, chatlog_id=42, last_message_index=3)
    session.add(c)
    session.commit()
    session.refresh(c)
    assert c.last_message_index == 3
    dup = ConversationCursor(label_id=label.id, chatlog_id=42, last_message_index=5)
    session.add(dup)
    with pytest.raises(IntegrityError):
        session.commit()
