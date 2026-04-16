# server/python/tests/test_stubs.py

def test_suggest_stub(client):
    r = client.post("/api/queue/suggest", json={"chatlog_id": 1, "message_index": 0})
    assert r.status_code == 200
    data = r.json()
    assert "label_name" in data
    assert "evidence" in data
    assert "rationale" in data


def test_merge_stub(client):
    l1 = client.post("/api/labels", json={"name": "S1"}).json()["id"]
    l2 = client.post("/api/labels", json={"name": "S2"}).json()["id"]
    r = client.post("/api/labels/merge", json={"source_label_id": l1, "target_label_id": l2})
    assert r.status_code == 200


def test_split_stub(client):
    l1 = client.post("/api/labels", json={"name": "S3"}).json()["id"]
    r = client.post("/api/labels/split", json={"label_id": l1, "name_a": "A", "name_b": "B"})
    assert r.status_code == 200


def test_analysis_summary_stub(client):
    r = client.get("/api/analysis/summary")
    assert r.status_code == 200
    data = r.json()
    assert "label_counts" in data
    assert "coverage" in data


def test_export_csv_stub(client):
    r = client.get("/api/export/csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]


def test_recalibration_stub(client):
    r = client.get("/api/session/recalibration")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_queue_sample_stub(client):
    r = client.get("/api/queue/sample")
    assert r.status_code == 200
