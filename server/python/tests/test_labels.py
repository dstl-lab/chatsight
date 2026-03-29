# server/python/tests/test_labels.py

def test_get_labels_empty(client):
    r = client.get("/api/labels")
    assert r.status_code == 200
    assert r.json() == []


def test_create_label(client):
    r = client.post("/api/labels", json={"name": "Concept Question"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Concept Question"
    assert data["description"] is None
    assert data["count"] == 0
    assert "id" in data


def test_create_label_with_description(client):
    r = client.post("/api/labels", json={
        "name": "Clarification",
        "description": "Student asks to restate or clarify AI's explanation"
    })
    assert r.status_code == 200
    assert r.json()["description"] == "Student asks to restate or clarify AI's explanation"


def test_update_label(client):
    label_id = client.post("/api/labels", json={"name": "Old Name"}).json()["id"]
    r = client.put(f"/api/labels/{label_id}", json={"name": "New Name"})
    assert r.status_code == 200
    assert r.json()["name"] == "New Name"


def test_get_labels_returns_count(client):
    label_id = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    # No applications yet
    labels = client.get("/api/labels").json()
    assert labels[0]["count"] == 0
