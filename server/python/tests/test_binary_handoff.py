from unittest.mock import patch
from sqlmodel import Session, select
from models import LabelDefinition, LabelApplication, MessageCache
from binary_autolabel_service import classify_binary_batch, run_handoff


def test_classify_binary_batch_calls_gemini_with_label_and_examples():
    label = {"name": "Concept Question", "description": "Asks about a concept"}
    yes_examples = ["What is a Series?"]
    no_examples = ["Run my notebook"]
    messages = [
        {"chatlog_id": 1, "message_index": 0, "message_text": "What is a DataFrame?"},
        {"chatlog_id": 1, "message_index": 1, "message_text": "fix my code"},
    ]
    fake_response = [
        {"index": 0, "value": "yes", "confidence": 0.92},
        {"index": 1, "value": "no", "confidence": 0.81},
    ]
    with patch("binary_autolabel_service._call_gemini", return_value=fake_response):
        result = classify_binary_batch(label=label, yes_examples=yes_examples, no_examples=no_examples, messages=messages)
    assert result == fake_response


def test_run_handoff_writes_ai_predictions_for_unlabeled(session: Session):
    label = LabelDefinition(name="L", description="d", is_active=True)
    session.add(label)
    session.commit()
    session.refresh(label)
    session.add(MessageCache(chatlog_id=1, message_index=0, message_text="x"))
    session.add(MessageCache(chatlog_id=1, message_index=1, message_text="y"))
    session.add(MessageCache(chatlog_id=2, message_index=0, message_text="z"))
    # human decision for one message
    session.add(LabelApplication(label_id=label.id, chatlog_id=1, message_index=0, value="yes", applied_by="human"))
    session.commit()

    fake = [
        {"index": 0, "value": "no", "confidence": 0.6},
        {"index": 1, "value": "yes", "confidence": 0.95},
    ]
    with patch("binary_autolabel_service.classify_binary_batch", return_value=fake):
        n = run_handoff(session, label_id=label.id)
    assert n == 2
    ai_rows = session.exec(
        select(LabelApplication).where(LabelApplication.applied_by == "ai")
    ).all()
    assert len(ai_rows) == 2

    session.refresh(label)
    assert label.phase == "handed_off"
