# server/python/tests/test_label_management.py

def test_merge_transfers_applications(client):
    l1 = client.post("/api/labels", json={"name": "Source Label"}).json()["id"]
    l2 = client.post("/api/labels", json={"name": "Target Label"}).json()["id"]
    
    client.post("/api/queue/apply", json={
        "chatlog_id": 1, "message_index": 0, "label_id": l1
    })
    
    r = client.post("/api/labels/merge", json={
        "source_label_id": l1,
        "target_label_id": l2
    })
    
    assert r.status_code == 200
    
    applied = client.get("/api/queue/applied", params={
        "chatlog_id": 1, "message_index": 0
    })
    assert applied.json()["label_ids"] == [l2]

def test_merge_deletes_source(client):
    l1 = client.post("/api/labels", json={"name": "Source"}).json()["id"]
    l2 = client.post("/api/labels", json={"name": "Target"}).json()["id"]
    
    client.post("/api/labels/merge", json={
        "source_label_id": l1,
        "target_label_id": l2
    })
    
    labels_after = client.get("/api/labels").json()
    label_ids = [l["id"] for l in labels_after]
    assert l1 not in label_ids

def test_merge_nonexistent_404(client):
    l2 = client.post("/api/labels", json={"name": "Target"}).json()["id"]
    r = client.post("/api/labels/merge", json={
        "source_label_id": 9999,
        "target_label_id": l2
    })
    assert r.status_code == 404

def test_split_creates_two_labels(client):
    l1 = client.post("/api/labels", json={"name": "To Split"}).json()["id"]
    
    r = client.post("/api/labels/split", json={
        "label_id": l1,
        "name_a": "Split A",
        "name_b": "Split B"
    })
    
    assert r.status_code == 200
    new_labels = r.json()
    assert len(new_labels) == 2
    assert new_labels[0]["name"] == "Split A"
    assert new_labels[1]["name"] == "Split B"
    
def test_split_deletes_original(client):
    l1 = client.post("/api/labels", json={"name": "To Split"}).json()["id"]
    
    client.post("/api/labels/split", json={
        "label_id": l1,
        "name_a": "Split A",
        "name_b": "Split B"
    })
    
    labels = client.get("/api/labels").json()
    label_ids = [l["id"] for l in labels]
    assert l1 not in label_ids

def test_delete_label_with_force(client):
    l1 = client.post("/api/labels", json={"name": "To Delete Force"}).json()["id"]
    
    client.post("/api/queue/apply", json={
        "chatlog_id": 1, "message_index": 0, "label_id": l1
    })
    
    r = client.delete(f"/api/labels/{l1}?force=true")
    assert r.status_code == 200
    assert r.json()["deleted_applications"] == 1
    
    labels = client.get("/api/labels").json()
    label_ids = [l["id"] for l in labels]
    assert l1 not in label_ids

def test_delete_label_without_force_400(client):
    l1 = client.post("/api/labels", json={"name": "To Delete No Force"}).json()["id"]
    
    client.post("/api/queue/apply", json={
        "chatlog_id": 1, "message_index": 0, "label_id": l1
    })
    
    r = client.delete(f"/api/labels/{l1}")
    assert r.status_code == 400
    
    # Verify label still exists
    labels = client.get("/api/labels").json()
    label_ids = [l["id"] for l in labels]
    assert l1 in label_ids

def test_delete_label_no_applications(client):
    l1 = client.post("/api/labels", json={"name": "Delete Me"}).json()["id"]
    
    r = client.delete(f"/api/labels/{l1}")
    assert r.status_code == 200
    
    labels = client.get("/api/labels").json()
    label_ids = [l["id"] for l in labels]
    assert l1 not in label_ids
