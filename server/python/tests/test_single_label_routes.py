from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlmodel import Session
from models import LabelDefinition, LabelApplication, MessageCache


def _seed(session: Session):
    label = LabelDefinition(name="Concept Question", description="asks about concept")
    session.add(label)
    session.add(MessageCache(chatlog_id=10, message_index=0, message_text="What is a Series?"))
    session.add(MessageCache(chatlog_id=10, message_index=1, message_text="fix my code"))
    session.add(MessageCache(chatlog_id=20, message_index=0, message_text="hello"))
    session.commit()
    session.refresh(label)
    return label


def test_create_and_list_labels(client: TestClient):
    r = client.post("/api/labels/binary", json={"name": "Foo", "description": "d"})
    assert r.status_code == 200
    r = client.get("/api/labels/binary")
    assert r.status_code == 200
    assert any(item["name"] == "Foo" for item in r.json())


def test_activate_close_lifecycle(client: TestClient, session: Session):
    label = _seed(session)
    r = client.post(f"/api/labels/binary/{label.id}/activate")
    assert r.status_code == 200
    session.refresh(label)
    assert label.is_active is True

    r = client.post(f"/api/labels/binary/{label.id}/close")
    assert r.status_code == 200
    session.refresh(label)
    assert label.is_active is False
    assert label.phase == "complete"


def test_next_decide_advances(client: TestClient, session: Session):
    label = _seed(session)
    client.post(f"/api/labels/binary/{label.id}/activate")

    r = client.get(f"/api/labels/binary/{label.id}/next")
    assert r.status_code == 200
    body = r.json()
    assert body["chatlog_id"] == 10 and body["message_index"] == 0
    assert body["done"] is False
    assert len(body["conversation_context"]) == 1  # message 0 itself

    r = client.post(f"/api/labels/binary/{label.id}/decide", json={
        "chatlog_id": 10, "message_index": 0, "value": "yes",
    })
    assert r.status_code == 200
    nxt = r.json()
    assert nxt["chatlog_id"] == 10 and nxt["message_index"] == 1


def test_decide_rejects_invalid_value(client: TestClient, session: Session):
    label = _seed(session)
    r = client.post(f"/api/labels/binary/{label.id}/decide", json={
        "chatlog_id": 10, "message_index": 0, "value": "bogus",
    })
    assert r.status_code == 422 or r.status_code == 400


def test_undo_removes_last_decision(client: TestClient, session: Session):
    label = _seed(session)
    client.post(f"/api/labels/binary/{label.id}/decide", json={"chatlog_id": 10, "message_index": 0, "value": "yes"})
    r = client.post(f"/api/labels/binary/{label.id}/undo")
    assert r.status_code == 200
    rows = session.exec(__import__("sqlmodel").select(LabelApplication)).all()
    assert len(rows) == 0


def test_readiness_endpoint(client: TestClient, session: Session):
    label = _seed(session)
    client.post(f"/api/labels/binary/{label.id}/decide", json={"chatlog_id": 10, "message_index": 0, "value": "yes"})
    client.post(f"/api/labels/binary/{label.id}/decide", json={"chatlog_id": 10, "message_index": 1, "value": "no"})
    r = client.get(f"/api/labels/binary/{label.id}/readiness")
    body = r.json()
    assert body["yes_count"] == 1
    assert body["no_count"] == 1
    assert body["ready"] is True


def test_handoff_runs_gemini_and_returns_count(client: TestClient, session: Session):
    label = _seed(session)
    fake = [
        {"index": 0, "value": "yes", "confidence": 0.5},
        {"index": 1, "value": "no", "confidence": 0.92},
        {"index": 2, "value": "no", "confidence": 0.7},
    ]
    with patch("binary_autolabel_service.classify_binary_batch", return_value=fake):
        r = client.post(f"/api/labels/binary/{label.id}/handoff")
    assert r.status_code == 200
    assert r.json()["predictions_written"] == 3


def test_review_queue_returns_low_confidence(client: TestClient, session: Session):
    label = _seed(session)
    session.add(LabelApplication(label_id=label.id, chatlog_id=10, message_index=0, value="yes", applied_by="ai", confidence=0.5))
    session.add(LabelApplication(label_id=label.id, chatlog_id=10, message_index=1, value="no", applied_by="ai", confidence=0.95))
    session.commit()
    r = client.get(f"/api/labels/binary/{label.id}/review-queue?threshold=0.75")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["chatlog_id"] == 10 and body["items"][0]["message_index"] == 0
