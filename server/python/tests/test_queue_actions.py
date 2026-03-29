# server/python/tests/test_queue_actions.py


def test_apply_is_idempotent(client):
    label_id = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    r1 = client.post("/api/queue/apply", json={
        "chatlog_id": 1, "message_index": 0, "label_id": label_id
    })
    assert r1.json().get("already_applied") is None or r1.json()["already_applied"] is not True
    r2 = client.post("/api/queue/apply", json={
        "chatlog_id": 1, "message_index": 0, "label_id": label_id
    })
    assert r2.json()["already_applied"] is True


def test_unapply_label(client):
    label_id = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    client.post("/api/queue/apply", json={
        "chatlog_id": 1, "message_index": 0, "label_id": label_id
    })
    r = client.delete("/api/queue/apply", params={
        "chatlog_id": 1, "message_index": 0, "label_id": label_id
    })
    assert r.status_code == 200
    # Verify it's gone
    applied = client.get("/api/queue/applied", params={
        "chatlog_id": 1, "message_index": 0
    })
    assert applied.json()["label_ids"] == []


def test_unapply_nonexistent_returns_404(client):
    r = client.delete("/api/queue/apply", params={
        "chatlog_id": 999, "message_index": 0, "label_id": 999
    })
    assert r.status_code == 404


def test_get_applied_labels(client):
    l1 = client.post("/api/labels", json={"name": "Label A"}).json()["id"]
    l2 = client.post("/api/labels", json={"name": "Label B"}).json()["id"]
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": l1})
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": l2})
    r = client.get("/api/queue/applied", params={"chatlog_id": 1, "message_index": 0})
    assert set(r.json()["label_ids"]) == {l1, l2}


def test_get_applied_labels_empty(client):
    r = client.get("/api/queue/applied", params={"chatlog_id": 999, "message_index": 0})
    assert r.json()["label_ids"] == []


def test_undo_removes_all_labels(client):
    client.post("/api/session/start")
    l1 = client.post("/api/labels", json={"name": "A"}).json()["id"]
    l2 = client.post("/api/labels", json={"name": "B"}).json()["id"]
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": l1})
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": l2})
    # Advance first so labeled_count = 1
    client.post("/api/queue/advance", json={"chatlog_id": 1, "message_index": 0})
    assert client.get("/api/session").json()["labeled_count"] == 1
    # Undo
    r = client.post("/api/queue/undo", json={"chatlog_id": 1, "message_index": 0})
    assert r.json()["removed_count"] == 2
    assert client.get("/api/session").json()["labeled_count"] == 0
    # Labels are gone
    applied = client.get("/api/queue/applied", params={"chatlog_id": 1, "message_index": 0})
    assert applied.json()["label_ids"] == []


def test_get_label_messages(client):
    label_id = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": label_id})
    client.post("/api/queue/apply", json={"chatlog_id": 2, "message_index": 1, "label_id": label_id})
    r = client.get(f"/api/labels/{label_id}/messages")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_multi_label_on_same_message(client):
    l1 = client.post("/api/labels", json={"name": "A"}).json()["id"]
    l2 = client.post("/api/labels", json={"name": "B"}).json()["id"]
    l3 = client.post("/api/labels", json={"name": "C"}).json()["id"]
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": l1})
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": l2})
    client.post("/api/queue/apply", json={"chatlog_id": 1, "message_index": 0, "label_id": l3})
    applied = client.get("/api/queue/applied", params={"chatlog_id": 1, "message_index": 0})
    assert set(applied.json()["label_ids"]) == {l1, l2, l3}
    # Label counts should each be 1
    labels = client.get("/api/labels").json()
    counts = {l["name"]: l["count"] for l in labels}
    assert counts["A"] == 1
    assert counts["B"] == 1
    assert counts["C"] == 1
