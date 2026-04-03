# server/python/tests/test_history_page.py
from unittest.mock import patch, MagicMock


def _mock_ext_message(lookup: dict):
    """Mock ext_engine for single-message and history fetches."""
    mock_conn = MagicMock()

    def fake_execute(sql, params=None):
        if params is None:
            params = {}
        key = (params.get("chatlog_id"), params.get("message_index"))
        entry = lookup.get(key, None)
        result = MagicMock()
        result.mappings.return_value.first.return_value = entry
        return result

    mock_conn.execute.side_effect = fake_execute
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_ctx.__exit__ = MagicMock(return_value=False)
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_ctx
    return mock_engine


def _add_cached_message(client_or_session, chatlog_id, message_index, message_text, context_before=None, context_after=None):
    """Helper: insert a MessageCache row directly via the test session."""
    from models import MessageCache
    from database import get_session
    from main import app
    # Get the overridden session from the client fixture
    override = app.dependency_overrides.get(get_session)
    if override:
        for sess in override():
            sess.add(MessageCache(
                chatlog_id=chatlog_id, message_index=message_index,
                message_text=message_text, context_before=context_before, context_after=context_after,
            ))
            sess.commit()
            break


def test_get_message_returns_queue_item(client):
    _add_cached_message(client, 1, 0, "What is a DataFrame?", "prev AI response", "next AI response")
    r = client.get("/api/queue/message", params={"chatlog_id": 1, "message_index": 0})
    assert r.status_code == 200
    data = r.json()
    assert data["chatlog_id"] == 1
    assert data["message_index"] == 0
    assert data["message_text"] == "What is a DataFrame?"
    assert data["context_before"] == "prev AI response"


def test_get_message_not_found(client):
    r = client.get("/api/queue/message", params={"chatlog_id": 999, "message_index": 0})
    assert r.status_code == 404


def test_history_filter_human_only(client):
    """filter=human returns only human-labeled messages."""
    _add_cached_message(client, 1, 0, "Msg 1")
    _add_cached_message(client, 2, 0, "Msg 2")

    client.post("/api/session/start")
    la = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": la})
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})
    client.post("/api/queue/skip", json={"chatlog_id": 2, "message_index": 0})

    r = client.get("/api/queue/history?filter=human")
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["applied_by"] == "human"


def test_history_filter_skipped(client):
    _add_cached_message(client, 1, 0, "Msg")
    client.post("/api/queue/skip", json={"chatlog_id": 1, "message_index": 0})

    r = client.get("/api/queue/history?filter=skipped")
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["status"] == "skipped"
    assert data["items"][0]["applied_by"] is None


def test_history_includes_applied_by_and_confidence(client):
    """History items include applied_by and confidence fields."""
    _add_cached_message(client, 1, 0, "Msg")

    client.post("/api/session/start")
    la = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": la})
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})

    r = client.get("/api/queue/history")
    item = r.json()["items"][0]
    assert item["applied_by"] == "human"
    assert item["confidence"] is None
