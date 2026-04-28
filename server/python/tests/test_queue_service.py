from sqlmodel import Session
from models import LabelDefinition, LabelApplication, MessageCache
from queue_service import next_undecided_message


def _seed_label(session: Session, name="L") -> LabelDefinition:
    label = LabelDefinition(name=name, is_active=True)
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


def _seed_msg(session: Session, chatlog_id: int, idx: int, text: str = "msg"):
    session.add(MessageCache(chatlog_id=chatlog_id, message_index=idx, message_text=text))
    session.commit()


def test_returns_first_message_of_first_conversation(session: Session):
    label = _seed_label(session)
    _seed_msg(session, 100, 0)
    _seed_msg(session, 100, 1)
    _seed_msg(session, 200, 0)
    result = next_undecided_message(session, label_id=label.id)
    assert result is not None
    assert result["chatlog_id"] == 100
    assert result["message_index"] == 0


def test_skips_decided_messages(session: Session):
    label = _seed_label(session)
    _seed_msg(session, 100, 0)
    _seed_msg(session, 100, 1)
    session.add(LabelApplication(label_id=label.id, chatlog_id=100, message_index=0, value="yes"))
    session.commit()
    result = next_undecided_message(session, label_id=label.id)
    assert result["chatlog_id"] == 100
    assert result["message_index"] == 1


def test_finishes_in_progress_conversation_before_starting_new_one(session: Session):
    label = _seed_label(session)
    _seed_msg(session, 100, 0)
    _seed_msg(session, 100, 1)
    _seed_msg(session, 200, 0)
    # 100/0 decided; 100 is in progress
    session.add(LabelApplication(label_id=label.id, chatlog_id=100, message_index=0, value="yes"))
    session.commit()
    result = next_undecided_message(session, label_id=label.id)
    # Must finish chatlog 100 before moving to 200
    assert result["chatlog_id"] == 100
    assert result["message_index"] == 1


def test_returns_none_when_all_decided(session: Session):
    label = _seed_label(session)
    _seed_msg(session, 100, 0)
    session.add(LabelApplication(label_id=label.id, chatlog_id=100, message_index=0, value="skip"))
    session.commit()
    assert next_undecided_message(session, label_id=label.id) is None
