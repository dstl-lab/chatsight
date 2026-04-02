# server/python/tests/test_merge_labels.py

def test_merge_labels_success(client):
    # 1. Create two labels
    l1 = client.post("/api/labels", json={"name": "Source Label"}).json()["id"]
    l2 = client.post("/api/labels", json={"name": "Target Label"}).json()["id"]
    
    # 2. Apply source label to a message
    client.post("/api/queue/apply", json={
        "chatlog_id": 1, "message_index": 0, "label_id": l1
    })
    
    # Verify initial state
    labels = client.get("/api/labels").json()
    counts = {l["id"]: l["count"] for l in labels}
    assert counts[l1] == 1
    assert counts[l2] == 0
    
    # 3. Merge l1 into l2
    r = client.post("/api/labels/merge", json={
        "source_label_id": l1,
        "target_label_id": l2
    })
    
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == l2
    assert data["count"] == 1
    
    # 4. Verify source label is gone
    labels_after = client.get("/api/labels").json()
    label_ids = [l["id"] for l in labels_after]
    assert l1 not in label_ids
    assert l2 in label_ids
    
    # 5. Verify application was updated
    applied = client.get("/api/queue/applied", params={
        "chatlog_id": 1, "message_index": 0
    })
    assert applied.json()["label_ids"] == [l2]

def test_merge_labels_nonexistent_source(client):
    l2 = client.post("/api/labels", json={"name": "Target"}).json()["id"]
    r = client.post("/api/labels/merge", json={
        "source_label_id": 9999,
        "target_label_id": l2
    })
    assert r.status_code == 404
    assert "Source label not found" in r.text

def test_merge_labels_nonexistent_target(client):
    l1 = client.post("/api/labels", json={"name": "Source"}).json()["id"]
    r = client.post("/api/labels/merge", json={
        "source_label_id": l1,
        "target_label_id": 9999
    })
    assert r.status_code == 404
    assert "Target label not found" in r.text
