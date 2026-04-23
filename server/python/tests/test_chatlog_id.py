# server/python/tests/test_chatlog_id.py
"""
Verify that chatlog_id (MIN(id) filtered to tutor events) is consistent
across all endpoints that compute or look up conversations.

Covers the bug where conversations starting with tutor_notebook_info events
produced a different MIN(id) than _fetch_conversation_events expected.
"""

from unittest.mock import MagicMock
from sqlalchemy import text

from main import app, get_ext_conn


def _make_ext_conn(rows):
    """Build a mock external DB connection that returns `rows` for any query."""
    mock_conn = MagicMock()
    mapping_rows = [dict(r) for r in rows]
    mock_conn.execute.return_value.mappings.return_value.all.return_value = mapping_rows
    return mock_conn


def _override_ext_conn(mock_conn):
    def override():
        yield mock_conn
    app.dependency_overrides[get_ext_conn] = override


def _cleanup():
    app.dependency_overrides.pop(get_ext_conn, None)


# ── list_chatlogs ────────────────────────────────────────────────────────────


def test_list_chatlogs_uses_tutor_event_id(client):
    """Chatlog ID should be MIN(id) among tutor events, not all events."""
    mock_conn = _make_ext_conn([
        {"id": 200, "user_email": "a@test.com", "notebook": "nb1", "created_at": "2026-01-01T00:00:00"},
    ])
    _override_ext_conn(mock_conn)
    try:
        r = client.get("/api/chatlogs")
        assert r.status_code == 200
        sql = mock_conn.execute.call_args[0][0]
        sql_text = sql.text if hasattr(sql, "text") else str(sql)
        assert "tutor_query" in sql_text
        assert "tutor_response" in sql_text
    finally:
        _cleanup()


# ── get_chatlog + get_chatlog_messages ───────────────────────────────────────


def test_get_chatlog_filters_by_tutor_events(client):
    """_fetch_conversation_events should filter by tutor event types."""
    mock_conn = _make_ext_conn([
        {
            "event_type": "tutor_query",
            "question": "How do I do this?",
            "response": None,
            "notebook": "nb1",
            "created_at": "2026-01-01T00:00:00",
            "user_email": "a@test.com",
            "started_at": "2026-01-01T00:00:00",
        },
        {
            "event_type": "tutor_response",
            "question": None,
            "response": "Here is how.",
            "notebook": "nb1",
            "created_at": "2026-01-01T00:00:01",
            "user_email": "a@test.com",
            "started_at": "2026-01-01T00:00:00",
        },
    ])
    _override_ext_conn(mock_conn)
    try:
        r = client.get("/api/chatlogs/200")
        assert r.status_code == 200
        sql = mock_conn.execute.call_args[0][0]
        sql_text = sql.text if hasattr(sql, "text") else str(sql)
        assert "tutor_query" in sql_text
        assert "tutor_response" in sql_text
    finally:
        _cleanup()


def test_get_chatlog_messages_returns_structured(client):
    """GET /api/chatlogs/{id}/messages should return student + assistant messages."""
    mock_conn = _make_ext_conn([
        {
            "event_type": "tutor_query",
            "question": "What is a DataFrame?",
            "response": None,
            "notebook": "nb1",
            "created_at": "2026-01-01T00:00:00",
            "user_email": "a@test.com",
            "started_at": "2026-01-01T00:00:00",
        },
        {
            "event_type": "tutor_response",
            "question": None,
            "response": "A DataFrame is a table.",
            "notebook": "nb1",
            "created_at": "2026-01-01T00:00:01",
            "user_email": "a@test.com",
            "started_at": "2026-01-01T00:00:00",
        },
    ])
    _override_ext_conn(mock_conn)
    try:
        r = client.get("/api/chatlogs/200/messages")
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) == 2
        assert msgs[0]["role"] == "student"
        assert msgs[0]["text"] == "What is a DataFrame?"
        assert msgs[0]["message_index"] == 0
        assert msgs[1]["role"] == "assistant"
        assert msgs[1]["text"] == "A DataFrame is a table."
        assert msgs[1]["message_index"] is None
    finally:
        _cleanup()


def test_get_chatlog_messages_404_when_empty(client):
    """Should return 404 when no tutor events found for the chatlog ID."""
    mock_conn = _make_ext_conn([])
    _override_ext_conn(mock_conn)
    try:
        r = client.get("/api/chatlogs/99999/messages")
        assert r.status_code == 404
    finally:
        _cleanup()


# ── notebook_info events should not affect chatlog_id ────────────────────────


def test_notebook_info_excluded_from_messages(client):
    """Non-tutor events like tutor_notebook_info should not appear in messages."""
    mock_conn = _make_ext_conn([
        {
            "event_type": "tutor_query",
            "question": "Help me",
            "response": None,
            "notebook": "nb1",
            "created_at": "2026-01-01T00:00:01",
            "user_email": "a@test.com",
            "started_at": "2026-01-01T00:00:01",
        },
    ])
    _override_ext_conn(mock_conn)
    try:
        r = client.get("/api/chatlogs/200/messages")
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) == 1
        assert msgs[0]["role"] == "student"
    finally:
        _cleanup()


# ── SQL consistency: all chatlog_id CTEs filter by event_type ────────────────


def test_sync_cache_sql_filters_tutor_events():
    """The sync_cache query's chatlog_ids CTE must filter by tutor event types."""
    import inspect, re
    from main import populate_message_cache
    try:
        from main import sync_cache
        src = inspect.getsource(sync_cache)
    except ImportError:
        src = inspect.getsource(populate_message_cache)

    match = re.search(
        r"chatlog_ids\s+AS\s*\((.*?GROUP\s+BY[^)]*\))",
        src,
        re.DOTALL | re.IGNORECASE,
    )
    assert match, "chatlog_ids CTE not found in populate_message_cache/sync_cache"
    cte_body = match.group(1)
    assert "tutor_query" in cte_body, (
        "chatlog_ids CTE must filter by tutor_query"
    )
    assert "tutor_response" in cte_body, (
        "chatlog_ids CTE must filter by tutor_response"
    )
