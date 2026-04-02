# server/python/tests/test_queue_polish.py
from unittest.mock import patch, MagicMock


def _mock_ext_engine(total_count: int):
    """Return a mock ext_engine whose connect() yields a scalar total_count."""
    mock_conn = MagicMock()
    mock_conn.execute.return_value.scalar.return_value = total_count
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_ctx.__exit__ = MagicMock(return_value=False)
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_ctx
    return mock_engine


def test_position_returns_remaining(client):
    """position = 1 when nothing labeled, total_remaining = total - 0 - 0."""
    with patch("main.ext_engine", _mock_ext_engine(100)):
        r = client.get("/api/queue/position")
    assert r.status_code == 200
    data = r.json()
    assert data["total_remaining"] == 100
    assert data["position"] == 1


def test_position_decrements_after_labeling(client):
    """After labeling 1 message and skipping 1, remaining = total - 2."""
    label_id = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    client.post("/api/session/start")
    # Apply + advance (counts as labeled)
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": label_id})
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})
    # Skip another
    client.post("/api/queue/skip", json={"chatlog_id": 2, "message_index": 0})

    with patch("main.ext_engine", _mock_ext_engine(100)):
        r = client.get("/api/queue/position")
    data = r.json()
    assert data["total_remaining"] == 98
    assert data["position"] == 3


def _mock_ext_conn_with_rows(rows):
    """Mock ext_engine.connect() to return a list of row mappings."""
    mock_result = MagicMock()
    mock_result.mappings.return_value.all.return_value = rows
    mock_conn = MagicMock()
    mock_conn.execute.return_value = mock_result
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_ctx.__exit__ = MagicMock(return_value=False)
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_ctx
    return mock_engine


def test_queue_seed_param_accepted(client):
    """GET /api/queue?seed=42 should return 200 and not crash."""
    mock_engine = _mock_ext_conn_with_rows([])
    with patch("main.ext_engine", mock_engine):
        r = client.get("/api/queue?seed=42&limit=5")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_queue_seed_uses_md5_order(client):
    """When seed is provided, the SQL should use MD5 ordering (not RANDOM)."""
    mock_engine = _mock_ext_conn_with_rows([])
    with patch("main.ext_engine", mock_engine):
        client.get("/api/queue?seed=99&limit=5")
    # Inspect the SQL string passed to execute
    call_args = mock_engine.connect.return_value.__enter__.return_value.execute.call_args
    sql_text = str(call_args[0][0])
    assert "MD5" in sql_text or "md5" in sql_text.lower()


def test_history_empty_when_nothing_labeled(client):
    r = client.get("/api/queue/history")
    assert r.status_code == 200
    assert r.json() == []


def test_history_returns_recent_items_in_order(client):
    """History returns labeled messages most-recent-first with correct labels."""
    client.post("/api/session/start")
    la = client.post("/api/labels", json={"name": "Concept Q"}).json()["id"]
    lb = client.post("/api/labels", json={"name": "Debug"}).json()["id"]

    # Label message (1, 0) with label A, then advance
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": la})
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})

    # Label message (2, 1) with labels A + B, then advance
    client.post("/api/queue/apply", json={"chatlog_id": 2, "message_index": 1, "label_id": la})
    client.post("/api/queue/apply", json={"chatlog_id": 2, "message_index": 1, "label_id": lb})
    client.post("/api/queue/advance", json={"chatlog_id": 2, "message_index": 1})

    # Mock ext_engine to return message_text per (chatlog_id, message_index)
    mock_conn = MagicMock()

    def fake_execute(sql, params=None):
        if params is None:
            params = {}
        lookup = {(1, 0): "Explain DataFrames", (2, 1): "How to filter rows"}
        text_val = lookup.get((params.get("chatlog_id"), params.get("message_index")), "")
        result = MagicMock()
        result.mappings.return_value.first.return_value = {"message_text": text_val}
        return result

    mock_conn.execute.side_effect = fake_execute
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_ctx.__exit__ = MagicMock(return_value=False)
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_ctx

    with patch("main.ext_engine", mock_engine):
        r = client.get("/api/queue/history?limit=20")

    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    # Most recent first: (2, 1) was labeled after (1, 0)
    assert items[0]["chatlog_id"] == 2
    assert items[0]["message_index"] == 1
    assert set(items[0]["labels"]) == {"Concept Q", "Debug"}
    assert items[1]["chatlog_id"] == 1
    assert items[1]["message_index"] == 0
    assert items[1]["labels"] == ["Concept Q"]
