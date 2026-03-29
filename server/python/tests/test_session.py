# server/python/tests/test_session.py

def test_start_session(client):
    r = client.post("/api/session/start")
    assert r.status_code == 200
    data = r.json()
    assert data["labeled_count"] == 0
    assert "id" in data


def test_get_session(client):
    client.post("/api/session/start")
    r = client.get("/api/session")
    assert r.status_code == 200
    assert r.json()["labeled_count"] == 0


def test_get_session_404_when_none(client):
    r = client.get("/api/session")
    assert r.status_code == 404


def test_apply_label_increments_session(client):
    client.post("/api/session/start")
    label_id = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    client.post("/api/queue/apply", json={
        "chatlog_id": 1, "message_index": 0, "label_id": label_id
    })
    assert client.get("/api/session").json()["labeled_count"] == 1
