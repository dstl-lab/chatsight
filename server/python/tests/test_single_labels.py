from sqlmodel import Session, select
from fastapi.testclient import TestClient
from models import LabelDefinition, LabelApplication


def _seed_label_with_rows(session, yes=10, no=5, review=2, human_gold=25):
    label = LabelDefinition(
        name="self-correction",
        description="catches own mistake",
        mode="single",
        phase="handed_off",
    )
    session.add(label)
    session.commit()
    session.refresh(label)

    # AI rows above threshold (default 0.7)
    for i in range(yes):
        session.add(LabelApplication(
            label_id=label.id, chatlog_id=i, message_index=0,
            applied_by="ai", value="yes", confidence=0.85,
        ))
    for i in range(no):
        session.add(LabelApplication(
            label_id=label.id, chatlog_id=1000 + i, message_index=0,
            applied_by="ai", value="no", confidence=0.85,
        ))
    # AI rows below threshold → land in Review bucket
    for i in range(review):
        session.add(LabelApplication(
            label_id=label.id, chatlog_id=2000 + i, message_index=0,
            applied_by="ai", value="yes", confidence=0.55,
        ))
    # Human "gold" rows: human-applied, with AI snapshot. Used for agreement metric.
    for i in range(human_gold):
        session.add(LabelApplication(
            label_id=label.id, chatlog_id=3000 + i, message_index=0,
            applied_by="human", value="yes",
            ai_value_at_review="yes",  # agree
        ))
    session.commit()
    return label


def test_get_label_detail_returns_counts_and_agreement(client: TestClient, session: Session):
    label = _seed_label_with_rows(session)
    r = client.get(f"/api/single-labels/{label.id}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == label.id
    assert body["name"] == "self-correction"
    assert body["review_threshold"] == 0.7
    assert body["yes_count"] >= 10
    assert body["no_count"] == 5
    assert body["review_count"] == 2
    assert isinstance(body["confidence_histogram"], list)
    assert len(body["confidence_histogram"]) == 10
    assert body["agreement_vs_gold"] is not None  # gold size >= 20


def test_get_label_detail_suppresses_agreement_when_gold_too_small(client, session):
    label = _seed_label_with_rows(session, human_gold=5)
    r = client.get(f"/api/single-labels/{label.id}")
    assert r.json()["agreement_vs_gold"] is None


def test_get_label_detail_404_for_multi_mode_label(client, session):
    label = LabelDefinition(name="multi-mode", mode="multi", phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    r = client.get(f"/api/single-labels/{label.id}")
    assert r.status_code == 404
