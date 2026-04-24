# server/python/tests/test_analysis.py
import csv
import io
from datetime import datetime, timezone

from models import LabelDefinition, LabelApplication, MessageCache


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

    ph = data["position_distribution_human"]
    assert ph["Concept Question"]["early"] == 2
    assert ph["Concept Question"]["mid"] == 0
    assert ph["Debug Help"]["late"] == 1
    pa = data["position_distribution_ai"]
    assert pa["Concept Question"]["mid"] == 1
    assert pa["Debug Help"]["mid"] == 1

    mix = data["label_source_mix"]["Concept Question"]
    # Human on (1,0)+(1,1); AI on (2,5) — disjoint messages
    assert mix["human_only"] == 2
    assert mix["ai_only"] == 1
    assert mix["both"] == 0
    mix_dh = data["label_source_mix"]["Debug Help"]
    assert mix_dh["human_only"] == 1
    assert mix_dh["ai_only"] == 1
    assert mix_dh["both"] == 0


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


def test_export_csv_applied_by_filter(client, session):
    _seed(session)
    r = client.get("/api/export/csv?applied_by=human")
    assert r.status_code == 200
    reader = csv.reader(io.StringIO(r.text))
    rows = list(reader)
    assert len(rows) == 4  # header + 3 human
    assert all(row[4] == "human" for row in rows[1:])

    r2 = client.get("/api/export/csv?applied_by=ai")
    assert r2.status_code == 200
    rows2 = list(csv.reader(io.StringIO(r2.text)))
    assert len(rows2) == 3
    assert all(row[4] == "ai" for row in rows2[1:])


def test_export_csv_date_filter(client, session):
    lbl = LabelDefinition(name="Solo")
    session.add(lbl)
    session.commit()
    session.refresh(lbl)
    t0 = datetime(2025, 6, 10, 12, 0, 0, tzinfo=timezone.utc)
    t1 = datetime(2025, 7, 5, 8, 0, 0, tzinfo=timezone.utc)
    session.add(
        LabelApplication(
            label_id=lbl.id,
            chatlog_id=9,
            message_index=0,
            applied_by="human",
            created_at=t0,
        )
    )
    session.add(
        LabelApplication(
            label_id=lbl.id,
            chatlog_id=9,
            message_index=1,
            applied_by="human",
            created_at=t1,
        )
    )
    session.commit()

    r = client.get("/api/export/csv?calendar_from=2025-06-01&calendar_to=2025-06-30")
    assert r.status_code == 200
    body = list(csv.reader(io.StringIO(r.text)))
    assert len(body) == 2

    r_bad = client.get("/api/export/csv?calendar_from=2025-06-01")
    assert r_bad.status_code == 400


def test_label_messages_human_only(client, session):
    _seed(session)
    session.add(MessageCache(chatlog_id=1, message_index=0, message_text="First student question"))
    session.add(MessageCache(chatlog_id=1, message_index=1, message_text="Second question"))
    session.commit()

    r = client.get("/api/analysis/label-messages?label_name=Concept Question&source=human_only")
    assert r.status_code == 200
    data = r.json()
    assert data["total_count"] == 2
    assert data["returned_count"] == 2
    assert data["truncated"] is False
    texts = {m["preview"] for m in data["messages"]}
    assert "First student question" in texts
    assert "Second question" in texts


def test_label_messages_ai_only(client, session):
    _seed(session)
    session.add(MessageCache(chatlog_id=2, message_index=5, message_text="AI labeled this"))
    session.commit()
    r = client.get("/api/analysis/label-messages?label_name=Concept Question&source=ai_only")
    assert r.status_code == 200
    data = r.json()
    assert data["total_count"] == 1
    assert data["messages"][0]["preview"] == "AI labeled this"


def test_label_messages_not_found(client, session):
    r = client.get("/api/analysis/label-messages?label_name=Missing&source=human_only")
    assert r.status_code == 404


def test_label_messages_bad_source(client, session):
    _seed(session)
    r = client.get("/api/analysis/label-messages?label_name=Concept Question&source=nope")
    assert r.status_code == 400
