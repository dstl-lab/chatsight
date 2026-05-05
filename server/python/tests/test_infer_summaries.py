"""Tests for /api/assignments/infer and /api/handoff-summaries."""
from unittest.mock import patch
from sqlmodel import select

import assignment_service
from models import AssignmentMapping, LabelApplication, LabelDefinition, MessageCache


def _seed_notebooks(session):
    session.add(MessageCache(chatlog_id=600, message_index=0, message_text="m", notebook="lab3.ipynb"))
    session.add(MessageCache(chatlog_id=601, message_index=0, message_text="m", notebook="lab03.ipynb"))
    session.add(MessageCache(chatlog_id=602, message_index=0, message_text="m", notebook="lab_3.ipynb"))
    session.add(MessageCache(chatlog_id=603, message_index=0, message_text="m", notebook="lab4.ipynb"))
    session.add(MessageCache(chatlog_id=604, message_index=0, message_text="m", notebook="project1.ipynb"))
    session.add(MessageCache(chatlog_id=605, message_index=0, message_text="m", notebook="hw2.ipynb"))
    session.add(MessageCache(chatlog_id=606, message_index=0, message_text="m", notebook=None))
    session.commit()


def test_infer_groups_lab_variants(session):
    _seed_notebooks(session)
    result = assignment_service.infer_assignments_from_cache(session)
    names = {m.name for m in session.exec(select(AssignmentMapping)).all()}
    assert "Lab 3" in names      # lab3 + lab03 + lab_3 should collapse
    assert "Lab 4" in names
    assert "Project 1" in names
    assert "Homework 2" in names
    assert result["created"] == 4
    assert result["total_notebooks"] == 6  # 6 distinct non-null notebooks


def test_infer_is_idempotent(session):
    _seed_notebooks(session)
    r1 = assignment_service.infer_assignments_from_cache(session)
    r2 = assignment_service.infer_assignments_from_cache(session)
    assert r1["created"] == 4
    assert r2["created"] == 0  # all already exist


def test_infer_assigns_messages_to_buckets(session):
    _seed_notebooks(session)
    assignment_service.infer_assignments_from_cache(session)
    counts = assignment_service.message_count_per_assignment(session)
    by_name = {
        m.id: m.name for m in session.exec(select(AssignmentMapping)).all()
    }
    name_counts = {by_name[k]: v for k, v in counts.items() if k is not None}
    assert name_counts["Lab 3"] == 3
    assert name_counts["Lab 4"] == 1
    assert name_counts["Project 1"] == 1
    assert name_counts["Homework 2"] == 1
    assert counts.get(None, 0) == 1  # the row with null notebook


def test_infer_endpoint(client, session):
    _seed_notebooks(session)
    r = client.post("/api/assignments/infer")
    assert r.status_code == 200
    body = r.json()
    assert body["created"] == 4
    assert body["total_notebooks"] == 6
    assert len(body["groups"]) == 4


def test_handoff_summaries_includes_handed_off_and_classifying(client, session):
    """Both labels currently classifying (background not yet complete) AND labels
    fully handed off appear on the summaries page. Pure 'labeling' labels do not."""
    import main
    from models import LabelDefinition

    _seed_notebooks(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    b = client.post("/api/single-labels", json={"name": "frustration"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    client.post(
        f"/api/single-labels/{a['id']}/decide",
        json={"chatlog_id": 600, "message_index": 0, "value": "yes"},
    )
    client.post(
        f"/api/single-labels/{a['id']}/decide",
        json={"chatlog_id": 601, "message_index": 0, "value": "no"},
    )

    def fake_classify(label_name, label_description, yes_examples, no_examples, messages):
        return [{"index": i, "value": "yes", "confidence": 0.9} for i in range(len(messages))]

    def fake_summary(*args, **kwargs):
        return {
            "included": [{"excerpt": "stuck", "frequency": "common", "confidence_avg": 0.92}],
            "excluded": [{"excerpt": "why", "frequency": "rare", "confidence_avg": 0.6}],
        }

    # Endpoint kicks off background async — endpoint test verifies phase=classifying.
    client.post(f"/api/single-labels/{a['id']}/handoff")
    r1 = client.get("/api/handoff-summaries")
    classifying = [it for it in r1.json() if it["label_name"] == "help"]
    assert len(classifying) == 1
    assert classifying[0]["phase"] == "classifying"
    assert classifying[0]["included"] == []  # not yet computed

    # Now run the inner classification function directly to simulate completion
    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=fake_classify), \
         patch("binary_autolabel_service.summarize_batch", side_effect=fake_summary):
        main._do_classification(session, label)

    r2 = client.get("/api/handoff-summaries")
    items = r2.json()
    handed = [it for it in items if it["label_name"] == "help"]
    assert len(handed) == 1
    assert handed[0]["phase"] == "handed_off"
    assert handed[0]["included"][0]["excerpt"] == "stuck"
    # Label B (still in 'labeling') should not appear
    assert all(it["label_name"] != "frustration" for it in items)
