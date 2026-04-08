# server/python/tests/test_label_reorder.py


def test_labels_returned_in_sort_order(client):
    """Labels should be returned sorted by sort_order, then id."""
    a = client.post("/api/labels", json={"name": "Alpha"}).json()["id"]
    b = client.post("/api/labels", json={"name": "Beta"}).json()["id"]
    c = client.post("/api/labels", json={"name": "Gamma"}).json()["id"]

    # Reorder: Gamma first, Alpha second, Beta third
    r = client.put("/api/labels/reorder", json={"label_ids": [c, a, b]})
    assert r.status_code == 200

    labels = client.get("/api/labels").json()
    assert [l["name"] for l in labels] == ["Gamma", "Alpha", "Beta"]


def test_reorder_updates_sort_order(client):
    """PUT /api/labels/reorder persists the new ordering."""
    a = client.post("/api/labels", json={"name": "A"}).json()["id"]
    b = client.post("/api/labels", json={"name": "B"}).json()["id"]

    client.put("/api/labels/reorder", json={"label_ids": [b, a]})
    labels = client.get("/api/labels").json()
    assert labels[0]["id"] == b
    assert labels[1]["id"] == a


def test_reorder_with_missing_id_returns_400(client):
    """If a label_id doesn't exist, return 400."""
    client.post("/api/labels", json={"name": "A"})
    r = client.put("/api/labels/reorder", json={"label_ids": [999]})
    assert r.status_code == 400


def test_new_label_gets_next_sort_order(client):
    """Newly created labels should appear at the end of the list."""
    client.post("/api/labels", json={"name": "First"})
    client.post("/api/labels", json={"name": "Second"})
    client.post("/api/labels", json={"name": "Third"})

    labels = client.get("/api/labels").json()
    assert [l["name"] for l in labels] == ["First", "Second", "Third"]
