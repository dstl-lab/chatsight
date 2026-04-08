# server/python/tests/test_queue_polish.py
from unittest.mock import patch, MagicMock


def _add_cache_rows(client, count):
    """Insert N MessageCache rows for position/stats tests."""
    from models import MessageCache
    from database import get_session
    from main import app
    override = app.dependency_overrides.get(get_session)
    if override:
        for sess in override():
            for i in range(count):
                sess.add(MessageCache(chatlog_id=i + 1, message_index=0, message_text=f"Msg {i}"))
            sess.commit()
            break


def test_position_returns_remaining(client):
    """position = 1 when nothing labeled, total_remaining = total - 0 - 0."""
    _add_cache_rows(client, 100)
    r = client.get("/api/queue/position")
    assert r.status_code == 200
    data = r.json()
    assert data["total_remaining"] == 100
    assert data["position"] == 1


def test_position_decrements_after_labeling(client):
    """After labeling 1 message and skipping 1, remaining = total - 2."""
    _add_cache_rows(client, 100)
    label_id = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    client.post("/api/session/start")
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": label_id})
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})
    client.post("/api/queue/skip", json={"chatlog_id": 2, "message_index": 0})

    r = client.get("/api/queue/position")
    data = r.json()
    assert data["total_remaining"] == 98
    assert data["position"] == 3


def test_queue_seed_param_accepted(client):
    """GET /api/queue?seed=42 should return 200 and not crash."""
    _add_cache_rows(client, 5)
    r = client.get("/api/queue?seed=42&limit=5")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_queue_seed_deterministic(client):
    """Same seed returns the same order; different seed returns different order."""
    _add_cache_rows(client, 10)
    r1 = client.get("/api/queue?seed=42&limit=10")
    r2 = client.get("/api/queue?seed=42&limit=10")
    r3 = client.get("/api/queue?seed=99&limit=10")
    ids1 = [m["chatlog_id"] for m in r1.json()]
    ids2 = [m["chatlog_id"] for m in r2.json()]
    ids3 = [m["chatlog_id"] for m in r3.json()]
    assert ids1 == ids2  # Same seed = same order
    # Different seed should (almost certainly) produce different order
    assert ids1 != ids3 or len(ids1) <= 1


def test_history_empty_when_nothing_labeled(client):
    r = client.get("/api/queue/history")
    assert r.status_code == 200
    data = r.json()
    assert data["items"] == []
    assert data["total"] == 0


def test_history_returns_recent_items_in_order(client):
    """History returns labeled messages most-recent-first with correct labels."""
    _add_cache_rows(client, 3)  # Creates chatlog_ids 1, 2, 3 at message_index 0

    client.post("/api/session/start")
    la = client.post("/api/labels", json={"name": "Concept Q"}).json()["id"]
    lb = client.post("/api/labels", json={"name": "Debug"}).json()["id"]

    # Label message (1, 0) with label A, then advance
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": la})
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})

    # Label message (2, 0) with labels A + B, then advance
    client.post("/api/queue/apply", json={"chatlog_id": 2, "message_index": 0, "label_id": la})
    client.post("/api/queue/apply", json={"chatlog_id": 2, "message_index": 0, "label_id": lb})
    client.post("/api/queue/advance", json={"chatlog_id": 2, "message_index": 0})

    r = client.get("/api/queue/history?limit=20")

    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 2
    # Most recent first: (2, 0) was labeled after (1, 0)
    assert items[0]["chatlog_id"] == 2
    assert items[0]["message_index"] == 0
    assert items[0]["status"] == "labeled"
    assert set(items[0]["labels"]) == {"Concept Q", "Debug"}
    assert items[1]["chatlog_id"] == 1
    assert items[1]["message_index"] == 0
    assert items[1]["labels"] == ["Concept Q"]
