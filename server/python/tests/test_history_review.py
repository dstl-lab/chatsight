# server/python/tests/test_history_review.py
from unittest.mock import patch, MagicMock


def _mock_ext_history_conn(lookup: dict):
    """Mock ext_engine for history endpoint: per-row message + context lookups."""
    mock_conn = MagicMock()

    def fake_execute(sql, params=None):
        if params is None:
            params = {}
        key = (params.get("chatlog_id"), params.get("message_index"))
        entry = lookup.get(key, {})
        result = MagicMock()
        result.mappings.return_value.first.return_value = entry or None
        return result

    mock_conn.execute.side_effect = fake_execute
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_ctx.__exit__ = MagicMock(return_value=False)
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_ctx
    return mock_engine


# ── Unskip endpoint ─────────────────────────────────────────────────────────


def test_unskip_deletes_skipped_message(client):
    """DELETE /api/queue/skip removes the SkippedMessage row."""
    client.post("/api/queue/skip", json={"chatlog_id": 1, "message_index": 0})
    r = client.delete("/api/queue/skip", params={"chatlog_id": 1, "message_index": 0})
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_unskip_nonexistent_returns_404(client):
    r = client.delete("/api/queue/skip", params={"chatlog_id": 999, "message_index": 0})
    assert r.status_code == 404


def test_unskip_then_skip_again(client):
    """After unskipping, message can be skipped again."""
    client.post("/api/queue/skip", json={"chatlog_id": 1, "message_index": 0})
    client.delete("/api/queue/skip", params={"chatlog_id": 1, "message_index": 0})
    r = client.post("/api/queue/skip", json={"chatlog_id": 1, "message_index": 0})
    assert r.status_code == 200


# ── Helpers ──────────────────────────────────────────────────────────────────

def _add_cache(client, chatlog_id, message_index, message_text, context_before=None, context_after=None):
    from models import MessageCache
    from database import get_session
    from main import app
    override = app.dependency_overrides.get(get_session)
    if override:
        for sess in override():
            sess.add(MessageCache(
                chatlog_id=chatlog_id, message_index=message_index,
                message_text=message_text, context_before=context_before, context_after=context_after,
            ))
            sess.commit()
            break


# ── History endpoint (new shape) ─────────────────────────────────────────────


def test_history_includes_skipped_messages(client):
    """History now returns both labeled and skipped messages."""
    _add_cache(client, 1, 0, "What is a DataFrame?", "prev", "next")
    _add_cache(client, 2, 1, "How do I filter?")

    client.post("/api/session/start")
    la = client.post("/api/labels", json={"name": "Concept"}).json()["id"]

    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": la})
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})
    client.post("/api/queue/skip", json={"chatlog_id": 2, "message_index": 1})

    r = client.get("/api/queue/history?limit=20")

    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data
    items = data["items"]
    assert len(items) == 2
    assert data["total"] == 2

    statuses = {item["status"] for item in items}
    assert statuses == {"labeled", "skipped"}

    labeled = next(i for i in items if i["status"] == "labeled")
    assert labeled["labels"] == ["Concept"]
    assert labeled["context_before"] == "prev"
    assert "processed_at" in labeled

    skipped = next(i for i in items if i["status"] == "skipped")
    assert skipped["labels"] == []
    assert skipped["message_text"] == "How do I filter?"


def test_history_returns_total_count(client):
    """History wraps response with total count."""
    r = client.get("/api/queue/history")
    assert r.status_code == 200
    data = r.json()
    assert data["items"] == []
    assert data["total"] == 0


def test_history_most_recent_first(client):
    """Items are ordered by most recently processed."""
    _add_cache(client, 1, 0, "Msg 1")
    _add_cache(client, 2, 0, "Msg 2")

    client.post("/api/session/start")
    la = client.post("/api/labels", json={"name": "A"}).json()["id"]

    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": la})
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})
    client.post("/api/queue/skip", json={"chatlog_id": 2, "message_index": 0})

    r = client.get("/api/queue/history?limit=20")

    items = r.json()["items"]
    assert items[0]["chatlog_id"] == 2
    assert items[0]["status"] == "skipped"
    assert items[1]["chatlog_id"] == 1
    assert items[1]["status"] == "labeled"
