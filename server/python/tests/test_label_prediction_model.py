"""Verify the LabelPrediction model is registered and round-trips correctly."""
import json

import sqlalchemy.exc
from sqlmodel import select

from models import LabelDefinition, LabelPrediction


def test_label_prediction_inserts_and_reads(session):
    label = LabelDefinition(name="seeking answer", mode="single")
    session.add(label)
    session.commit()
    session.refresh(label)

    neighbors = [
        {"chatlog_id": 1, "message_index": 0, "value": "yes", "similarity": 0.84, "message_text": "i'm stuck"},
        {"chatlog_id": 2, "message_index": 1, "value": "no", "similarity": 0.71, "message_text": "what is variance"},
    ]
    pred = LabelPrediction(
        label_id=label.id,
        chatlog_id=10,
        message_index=2,
        nearest_neighbors=json.dumps(neighbors),
        model_version=12,
    )
    session.add(pred)
    session.commit()

    fresh = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label.id)
    ).first()
    assert fresh is not None
    assert fresh.chatlog_id == 10
    assert fresh.message_index == 2
    assert fresh.model_version == 12
    decoded = json.loads(fresh.nearest_neighbors)
    assert len(decoded) == 2
    assert decoded[0]["value"] == "yes"


def test_label_prediction_unique_per_message(session):
    label = LabelDefinition(name="x", mode="single")
    session.add(label)
    session.commit()
    session.refresh(label)

    a = LabelPrediction(label_id=label.id, chatlog_id=1, message_index=0,
                        nearest_neighbors="[]", model_version=1)
    session.add(a)
    session.commit()

    b = LabelPrediction(label_id=label.id, chatlog_id=1, message_index=0,
                        nearest_neighbors="[]", model_version=2)
    session.add(b)
    try:
        session.commit()
        raise AssertionError("expected unique constraint violation")
    except sqlalchemy.exc.IntegrityError:
        session.rollback()
