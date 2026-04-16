# server/python/tests/test_temporal_analysis.py
from datetime import datetime

from models import LabelDefinition, LabelApplication


def _seed_labels(session):
    a = LabelDefinition(name="Alpha")
    b = LabelDefinition(name="Beta")
    session.add(a)
    session.add(b)
    session.commit()
    session.refresh(a)
    session.refresh(b)
    return a, b


def test_temporal_response_shape(client):
    r = client.get("/api/analysis/temporal")
    assert r.status_code == 200
    data = r.json()
    assert "tutor_usage" in data
    assert len(data["tutor_usage"]["by_hour"]) == 24
    assert data["tutor_usage"]["by_hour"][0]["hour"] == 0
    assert len(data["tutor_usage"]["by_weekday"]) == 7
    assert data["tutor_usage"]["by_weekday"][0]["weekday"] == 0
    assert "timezone_note" in data["tutor_usage"]
    assert "by_day" in data["tutor_usage"]
    assert isinstance(data["tutor_usage"]["by_day"], list)

    hm = data["notebook_label_heatmap"]
    assert "labels" in hm and "notebooks" in hm
    assert "raw_counts" in hm and "row_normalized" in hm and "column_normalized" in hm

    assert isinstance(data["labeling_throughput"], list)


def test_temporal_throughput_by_day_and_source(client, session):
    a, b = _seed_labels(session)
    day = datetime(2026, 4, 10, 15, 30, 0)
    session.add(
        LabelApplication(
            label_id=a.id, chatlog_id=1, message_index=0, applied_by="human", created_at=day
        )
    )
    session.add(
        LabelApplication(
            label_id=a.id, chatlog_id=2, message_index=0, applied_by="human", created_at=day
        )
    )
    session.add(
        LabelApplication(
            label_id=b.id, chatlog_id=3, message_index=0, applied_by="ai", created_at=day
        )
    )
    session.commit()

    r = client.get("/api/analysis/temporal")
    data = r.json()
    row = next(x for x in data["labeling_throughput"] if x["date"] == "2026-04-10")
    assert row["human"] == 2
    assert row["ai"] == 1
    assert row["total"] == 3


def test_temporal_throughput_fills_gap_days(client, session):
    a, _ = _seed_labels(session)
    session.add(
        LabelApplication(
            label_id=a.id,
            chatlog_id=1,
            message_index=0,
            applied_by="human",
            created_at=datetime(2026, 5, 1, 10, 0, 0),
        )
    )
    session.add(
        LabelApplication(
            label_id=a.id,
            chatlog_id=2,
            message_index=0,
            applied_by="human",
            created_at=datetime(2026, 5, 3, 10, 0, 0),
        )
    )
    session.commit()

    r = client.get("/api/analysis/temporal")
    data = r.json()
    dates = [x["date"] for x in data["labeling_throughput"]]
    assert dates == ["2026-05-01", "2026-05-02", "2026-05-03"]
    mid = next(x for x in data["labeling_throughput"] if x["date"] == "2026-05-02")
    assert mid["human"] == 0 and mid["ai"] == 0 and mid["total"] == 0


def test_temporal_calendar_params_must_be_paired(client):
    r = client.get("/api/analysis/temporal?calendar_from=2026-01-01")
    assert r.status_code == 400
