# server/python/tests/test_analysis.py
import csv
import io
from models import LabelDefinition, LabelApplication


def _seed(session):
    """Insert sample labels and applications for testing."""
    lbl_concept = LabelDefinition(name="Concept Question")
    lbl_debug = LabelDefinition(name="Debug Help")
    session.add(lbl_concept)
    session.add(lbl_debug)
    session.commit()
    session.refresh(lbl_concept)
    session.refresh(lbl_debug)

    apps = [
        LabelApplication(label_id=lbl_concept.id, chatlog_id=1, message_index=0, applied_by="human"),
        LabelApplication(label_id=lbl_concept.id, chatlog_id=1, message_index=1, applied_by="human"),
        LabelApplication(label_id=lbl_concept.id, chatlog_id=2, message_index=5, applied_by="ai"),
        LabelApplication(label_id=lbl_debug.id, chatlog_id=3, message_index=10, applied_by="human"),
        LabelApplication(label_id=lbl_debug.id, chatlog_id=3, message_index=4, applied_by="ai"),
    ]
    for a in apps:
        session.add(a)
    session.commit()
    return lbl_concept, lbl_debug


def test_summary_empty(client):
    r = client.get("/api/analysis/summary")
    assert r.status_code == 200
    data = r.json()
    assert data["label_counts"] == {}
    assert data["coverage"]["human_labeled"] == 0
    assert data["coverage"]["ai_labeled"] == 0
    assert data["position_distribution"] == {}


def test_summary_label_counts(client, session):
    _seed(session)
    r = client.get("/api/analysis/summary")
    data = r.json()
    assert data["label_counts"]["Concept Question"] == 3
    assert data["label_counts"]["Debug Help"] == 2
    assert data["human_label_counts"]["Concept Question"] == 2
    assert data["human_label_counts"]["Debug Help"] == 1
    assert data["ai_label_counts"]["Concept Question"] == 1
    assert data["ai_label_counts"]["Debug Help"] == 1


def test_summary_coverage(client, session):
    _seed(session)
    r = client.get("/api/analysis/summary")
    data = r.json()
    assert data["coverage"]["human_labeled"] == 3
    assert data["coverage"]["ai_labeled"] == 2


def test_summary_position_distribution(client, session):
    _seed(session)
    r = client.get("/api/analysis/summary")
    data = r.json()
    pos = data["position_distribution"]
    # Concept Question: index 0 (early), 1 (early), 5 (mid)
    assert pos["Concept Question"]["early"] == 2
    assert pos["Concept Question"]["mid"] == 1
    assert pos["Concept Question"]["late"] == 0
    # Debug Help: index 10 (late), 4 (mid)
    assert pos["Debug Help"]["early"] == 0
    assert pos["Debug Help"]["mid"] == 1
    assert pos["Debug Help"]["late"] == 1


def test_export_csv_empty(client):
    r = client.get("/api/export/csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    reader = csv.reader(io.StringIO(r.text))
    rows = list(reader)
    assert rows[0] == ["chatlog_id", "message_index", "message_text", "label_name", "applied_by", "created_at"]
    assert len(rows) == 1


def test_export_csv_with_data(client, session):
    _seed(session)
    r = client.get("/api/export/csv")
    assert r.status_code == 200
    reader = csv.reader(io.StringIO(r.text))
    rows = list(reader)
    header = rows[0]
    assert "chatlog_id" in header
    assert "label_name" in header
    assert "applied_by" in header
    # 5 applications + 1 header row
    assert len(rows) == 6
    label_names = {row[header.index("label_name")] for row in rows[1:]}
    assert "Concept Question" in label_names
    assert "Debug Help" in label_names
