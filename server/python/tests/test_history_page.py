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


def test_get_message_returns_queue_item(client):
    lookup = {
        (1, 0): {
            "message_text": "What is a DataFrame?",
            "context_before": "prev AI response",
            "context_after": "next AI response",
        }
    }
    with patch("main.ext_engine", _mock_ext_message(lookup)):
        r = client.get("/api/queue/message", params={"chatlog_id": 1, "message_index": 0})
    assert r.status_code == 200
    data = r.json()
    assert data["chatlog_id"] == 1
    assert data["message_index"] == 0
    assert data["message_text"] == "What is a DataFrame?"
    assert data["context_before"] == "prev AI response"


def test_get_message_not_found(client):
    lookup = {}
    with patch("main.ext_engine", _mock_ext_message(lookup)):
        r = client.get("/api/queue/message", params={"chatlog_id": 999, "message_index": 0})
    assert r.status_code == 404


def test_history_filter_human_only(client):
    """filter=human returns only human-labeled messages."""
    client.post("/api/session/start")
    la = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    # Human label
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": la})
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})
    # Skip
    client.post("/api/queue/skip", json={"chatlog_id": 2, "message_index": 0})

    lookup = {
        (1, 0): {"message_text": "Msg 1", "context_before": None, "context_after": None},
        (2, 0): {"message_text": "Msg 2", "context_before": None, "context_after": None},
    }
    with patch("main.ext_engine", _mock_ext_message(lookup)):
        r = client.get("/api/queue/history?filter=human")
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["applied_by"] == "human"


def test_history_filter_skipped(client):
    client.post("/api/queue/skip", json={"chatlog_id": 1, "message_index": 0})

    lookup = {(1, 0): {"message_text": "Msg", "context_before": None, "context_after": None}}
    with patch("main.ext_engine", _mock_ext_message(lookup)):
        r = client.get("/api/queue/history?filter=skipped")
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["status"] == "skipped"
    assert data["items"][0]["applied_by"] is None


def test_history_includes_applied_by_and_confidence(client):
    """History items include applied_by and confidence fields."""
    client.post("/api/session/start")
    la = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": la})
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})

    lookup = {(1, 0): {"message_text": "Msg", "context_before": None, "context_after": None}}
    with patch("main.ext_engine", _mock_ext_message(lookup)):
        r = client.get("/api/queue/history")
    item = r.json()["items"][0]
    assert item["applied_by"] == "human"
    assert item["confidence"] is None
