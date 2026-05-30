from datetime import datetime

from sqlmodel import Session

from models import LabelApplication, LabelDefinition, MessageCache


def _make_multi(session: Session, name: str) -> LabelDefinition:
    ld = LabelDefinition(name=name, description=f"desc for {name}", mode="multi")
    session.add(ld)
    session.commit()
    session.refresh(ld)
    return ld


def _add_multi(
    session: Session,
    label_id: int,
    chatlog_id: int,
    msg_idx: int,
    *,
    applied_by: str = "human",
    confidence: float | None = None,
) -> None:
    session.add(
        LabelApplication(
            label_id=label_id,
            chatlog_id=chatlog_id,
            message_index=msg_idx,
            applied_by=applied_by,
            value=None,
            confidence=confidence,
            created_at=datetime.utcnow(),
        )
    )
    session.commit()


def test_multi_cohort_empty(client):
    r = client.get("/api/analysis/multi-label/cohort")
    assert r.status_code == 200
    assert r.json() == {"labels": []}


def test_multi_cohort_lists_labels(client, session):
    _make_multi(session, "Concept Question")
    rows = client.get("/api/analysis/multi-label/cohort").json()["labels"]
    assert len(rows) == 1
    assert rows[0]["label_name"] == "Concept Question"
    assert rows[0]["human_count"] == 0
    assert rows[0]["ai_count"] == 0


def test_multi_cohort_counts_human_and_ai(client, session):
    ld = _make_multi(session, "Debug Help")
    _add_multi(session, ld.id, 1, 0, applied_by="human")
    _add_multi(session, ld.id, 1, 1, applied_by="human")
    _add_multi(session, ld.id, 2, 0, applied_by="ai", confidence=0.92)
    row = client.get("/api/analysis/multi-label/cohort").json()["labels"][0]
    assert row["human_count"] == 2
    assert row["ai_count"] == 1
    assert row["total_count"] == 3
    assert row["high_conf_pct"] == 100


def test_multi_detail_not_found(client):
    assert client.get("/api/analysis/multi-label/labels/99999").status_code == 404


def test_multi_detail_rejects_single_label(client, session):
    ld = LabelDefinition(name="binary", mode="single", phase="labeling", is_active=True)
    session.add(ld)
    session.commit()
    session.refresh(ld)
    assert client.get(f"/api/analysis/multi-label/labels/{ld.id}").status_code == 404


def test_multi_detail_with_co_labels(client, session):
    a = _make_multi(session, "Concept Question")
    b = _make_multi(session, "Debug Help")
    _add_multi(session, a.id, 10, 0, applied_by="human")
    _add_multi(session, b.id, 10, 0, applied_by="human")
    session.add(
        MessageCache(
            chatlog_id=10,
            message_index=0,
            message_text="How do I filter rows?",
            created_at=datetime.utcnow(),
        )
    )
    session.commit()

    body = client.get(f"/api/analysis/multi-label/labels/{a.id}").json()
    assert body["label"]["label_name"] == "Concept Question"
    assert body["label"]["human_count"] == 1
    assert len(body["co_occurring_labels"]) == 1
    assert body["co_occurring_labels"][0]["label_name"] == "Debug Help"
    assert len(body["examples"]["human"]) == 1
    assert body["examples"]["human"][0]["co_labels"] == ["Debug Help"]
