"""Tests for handoff (now background-async), summary, refine, and review-queue endpoints."""
from unittest.mock import patch

from sqlmodel import select

import main
from models import LabelApplication, LabelDefinition, MessageCache


def _seed(session, conversations=2, per_conv=4):
    for c in range(conversations):
        for i in range(per_conv):
            session.add(MessageCache(
                chatlog_id=300 + c,
                message_index=i,
                message_text=f"conv {300 + c} msg {i}",
                notebook="lab3.ipynb",
            ))
    session.commit()


def _make_active_label(client):
    label = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{label['id']}/activate")
    return label


def _decide(client, label_id, chatlog_id, message_index, value):
    return client.post(
        f"/api/single-labels/{label_id}/decide",
        json={"chatlog_id": chatlog_id, "message_index": message_index, "value": value},
    )


def _run_classification(session, label_id):
    """Test helper — run the same classification path the background task would, but
    using the test's in-memory session. Bypasses Gemini entirely via patches."""
    def fake_classify(label_name, label_description, yes_examples, no_examples, messages):
        return [
            {"index": i, "value": "yes" if i % 2 == 0 else "no", "confidence": 0.9 if i < 2 else 0.4}
            for i in range(len(messages))
        ]

    def fake_summary(label_name, label_description, yes_messages, no_messages):
        return {
            "included": [{"excerpt": "stuck", "frequency": "common", "confidence_avg": 0.92}],
            "excluded": [{"excerpt": "why", "frequency": "moderate", "confidence_avg": 0.7}],
        }

    label = session.get(LabelDefinition, label_id)
    with patch("binary_autolabel_service.classify_binary", side_effect=fake_classify), \
         patch("binary_autolabel_service.summarize_batch", side_effect=fake_summary):
        main._do_classification(session, label)


def test_handoff_kicks_off_async_and_pops_next(client, session):
    """The endpoint returns immediately. The label is marked 'classifying' and
    deactivated; the next queued label is auto-activated."""
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    b = client.post("/api/single-labels/queue", json={"name": "frustration"}).json()

    r = client.post(f"/api/single-labels/{a['id']}/handoff")
    assert r.status_code == 200
    body = r.json()
    # Returns immediately — counts are 0 until the background task completes
    assert body["classified"] == 0

    # Original label moved to 'classifying' and was deactivated
    a_fresh = session.get(LabelDefinition, a["id"])
    session.refresh(a_fresh)
    assert a_fresh.phase == "classifying"
    assert a_fresh.is_active is False

    # The previously-queued label took over as active
    b_fresh = session.get(LabelDefinition, b["id"])
    session.refresh(b_fresh)
    assert b_fresh.is_active is True
    assert b_fresh.phase == "labeling"
    assert b_fresh.queue_position is None


def test_handoff_with_no_queue_leaves_no_active(client, session):
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    r = client.post(f"/api/single-labels/{a['id']}/handoff")
    assert r.status_code == 200
    active = client.get("/api/single-labels/active").json()
    assert active is None  # nothing queued; no replacement


def test_handoff_rejects_double_classify(client, session):
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    client.post(f"/api/single-labels/{a['id']}/handoff")

    # Try to hand off again while still classifying
    r = client.post(f"/api/single-labels/{a['id']}/handoff")
    assert r.status_code == 409


def test_classification_writes_ai_rows_and_summary(client, session):
    """Direct test of _do_classification with mocked Gemini."""
    _seed(session, conversations=2, per_conv=3)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")
    _decide(client, a["id"], 300, 1, "no")

    _run_classification(session, a["id"])

    # 4 remaining messages classified
    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) == 4

    fresh = session.get(LabelDefinition, a["id"])
    assert fresh.phase == "handed_off"
    assert fresh.summary_json is not None


def test_summary_endpoint_after_classification(client, session):
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")
    _decide(client, a["id"], 300, 1, "no")
    _run_classification(session, a["id"])

    r = client.get(f"/api/single-labels/{a['id']}/summary")
    assert r.status_code == 200
    body = r.json()
    assert body["label_name"] == "help"
    assert len(body["included"]) == 1
    assert body["included"][0]["excerpt"] == "stuck"


def test_refine_drops_ai_rows_and_reverts_phase(client, session):
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")
    _decide(client, a["id"], 300, 1, "no")
    _run_classification(session, a["id"])

    r = client.post(f"/api/single-labels/{a['id']}/refine")
    assert r.status_code == 200
    assert r.json()["phase"] == "labeling"

    post_ai = session.exec(
        select(LabelApplication).where(LabelApplication.applied_by == "ai")
    ).all()
    assert post_ai == []
    human_rows = session.exec(
        select(LabelApplication).where(LabelApplication.applied_by == "human")
    ).all()
    assert len(human_rows) == 2


def test_review_queue_returns_low_confidence_only(client, session):
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")
    _decide(client, a["id"], 300, 1, "no")
    _run_classification(session, a["id"])

    r = client.get(f"/api/single-labels/{a['id']}/review-queue")
    assert r.status_code == 200
    items = r.json()
    # 8 messages total, 2 decided → 6 pending. fake_classify gives 0.9 for indices 0-1
    # and 0.4 for 2-5, so 4 fall below the 0.75 review threshold.
    assert len(items) == 4
    assert all(it["ai_confidence"] < 0.75 for it in items)


def test_review_overrides_ai_decision(client, session):
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")
    _decide(client, a["id"], 300, 1, "no")
    _run_classification(session, a["id"])

    # Find a low-confidence row to override
    low = session.exec(
        select(LabelApplication)
        .where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
            LabelApplication.confidence < 0.75,
        )
    ).first()
    assert low is not None

    r = client.post(
        f"/api/single-labels/{a['id']}/review",
        json={
            "chatlog_id": low.chatlog_id,
            "message_index": low.message_index,
            "value": "yes",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ai_value"] == "yes"
    assert body["ai_confidence"] == 1.0


def test_classifying_label_appears_in_summaries(client, session):
    """Even before the background classification completes, the label is visible
    on /api/handoff-summaries (with empty patterns) so the user can see what's
    pending."""
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    client.post(f"/api/single-labels/{a['id']}/handoff")

    r = client.get("/api/handoff-summaries")
    assert r.status_code == 200
    items = r.json()
    assert any(item["label_name"] == "help" and item["phase"] == "classifying" for item in items)


def test_two_sequential_handoffs_both_appear_in_summaries(client, session):
    """Regression: hand off two different active labels back-to-back. Both should
    appear on /api/handoff-summaries — not silently disappear."""
    _seed(session, conversations=2, per_conv=2)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    b = client.post("/api/single-labels/queue", json={"name": "frustration"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")
    _decide(client, a["id"], 300, 1, "no")

    # First handoff (label a → classifying, b auto-activated)
    r1 = client.post(f"/api/single-labels/{a['id']}/handoff")
    assert r1.status_code == 200
    # Simulate the bg task completing for a
    _run_classification(session, a["id"])

    # Now b is the active label. Decide on it and hand off.
    _decide(client, b["id"], 301, 0, "yes")
    _decide(client, b["id"], 301, 1, "no")
    r2 = client.post(f"/api/single-labels/{b['id']}/handoff")
    assert r2.status_code == 200
    _run_classification(session, b["id"])

    items = client.get("/api/handoff-summaries").json()
    names = {it["label_name"] for it in items}
    assert "help" in names
    assert "frustration" in names
    assert len(items) == 2


def test_handoff_rejects_zero_sample_size(client, session):
    """sample_size must be a positive int — zero is rejected before any work starts."""
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    r = client.post(f"/api/single-labels/{a['id']}/handoff?sample_size=0")
    assert r.status_code == 400
    # Label should still be in 'labeling' phase (not flipped to 'classifying')
    fresh = session.get(LabelDefinition, a["id"])
    assert fresh.phase == "labeling"


def test_handoff_rejects_negative_sample_size(client, session):
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    r = client.post(f"/api/single-labels/{a['id']}/handoff?sample_size=-5")
    assert r.status_code == 400


def test_sample_size_caps_pending_to_n(client, session):
    """With sample_size set, only that many AI rows are written and
    classification_total reflects the sample size, not the full pending set."""
    _seed(session, conversations=5, per_conv=4)  # 20 cached messages
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    def fake_classify(label_name, label_description, yes_examples, no_examples, messages):
        return [
            {"index": i, "value": "yes", "confidence": 0.9}
            for i in range(len(messages))
        ]

    def fake_summary(label_name, label_description, yes_messages, no_messages):
        return {"included": [], "excluded": []}

    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=fake_classify), \
         patch("binary_autolabel_service.summarize_batch", side_effect=fake_summary):
        main._do_classification(session, label, sample_size=8)

    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) == 8

    fresh = session.get(LabelDefinition, a["id"])
    assert fresh.classification_total == 8
    assert fresh.classified_count == 8


def test_sample_size_above_pending_uses_all(client, session):
    """sample_size > len(pending) clamps to all of pending."""
    _seed(session, conversations=2, per_conv=3)  # 6 cached messages
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    def fake_classify(label_name, label_description, yes_examples, no_examples, messages):
        return [
            {"index": i, "value": "yes", "confidence": 0.9}
            for i in range(len(messages))
        ]

    def fake_summary(label_name, label_description, yes_messages, no_messages):
        return {"included": [], "excluded": []}

    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=fake_classify), \
         patch("binary_autolabel_service.summarize_batch", side_effect=fake_summary):
        main._do_classification(session, label, sample_size=400)

    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) == 6  # all of pending, clamped from 400


def test_sample_size_omitted_classifies_all_pending(client, session):
    """Regression check: when sample_size is None, behavior is identical to before."""
    _seed(session, conversations=3, per_conv=4)  # 12 cached messages
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    def fake_classify(label_name, label_description, yes_examples, no_examples, messages):
        return [
            {"index": i, "value": "yes", "confidence": 0.9}
            for i in range(len(messages))
        ]

    def fake_summary(label_name, label_description, yes_messages, no_messages):
        return {"included": [], "excluded": []}

    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=fake_classify), \
         patch("binary_autolabel_service.summarize_batch", side_effect=fake_summary):
        main._do_classification(session, label)  # no sample_size

    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) == 12

    fresh = session.get(LabelDefinition, a["id"])
    assert fresh.classification_total == 12


def test_batch_request_shape_uses_snake_case_protocol_and_uppercase_type_enums():
    """Regression: Gemini's Batch API rejects requests when JSON-schema `type`
    values aren't the proto Type enum (UPPERCASE) or when protocol-level fields
    aren't snake_case. The synchronous path is permissive about both because the
    SDK normalizes typed objects before sending, but the Batch JSONL is sent
    raw. Locking the wire shape here so we don't regress to the hand-built
    camelCase + lowercase-types shape that originally bounced with HTTP 400
    INVALID_ARGUMENT."""
    import binary_autolabel_service as bas
    req = bas.build_classify_batch_request(
        key="t",
        label_name="x",
        label_description=None,
        yes_examples=["yes ex"],
        no_examples=["no ex"],
        messages=["m1", "m2"],
    )
    body = req["request"]

    # Protocol fields must be snake_case (matches the docs Batch JSONL example).
    assert "system_instruction" in body
    assert "generation_config" in body
    assert "tool_config" in body
    assert "function_calling_config" in body["tool_config"]
    assert "allowed_function_names" in body["tool_config"]["function_calling_config"]

    # No camelCase leftovers that would confuse the validator.
    assert "systemInstruction" not in body
    assert "generationConfig" not in body
    assert "toolConfig" not in body

    # function_declarations is also snake_case here (not functionDeclarations).
    fd = body["tools"][0]["function_declarations"][0]
    params = fd["parameters"]

    # Type enum must be the proto UPPERCASE form, not JSON-schema lowercase.
    assert params["type"] == "OBJECT"
    classifications = params["properties"]["classifications"]
    assert classifications["type"] == "ARRAY"
    item = classifications["items"]
    assert item["type"] == "OBJECT"
    assert item["properties"]["index"]["type"] == "INTEGER"
    assert item["properties"]["value"]["type"] == "STRING"
    assert item["properties"]["confidence"]["type"] == "NUMBER"


def test_failed_handoff_still_appears_with_error(client, session):
    """When the background classification raises, the label is marked phase='failed'
    with the error stashed in summary_json. It still appears on /summaries so the
    instructor can see the failure rather than have the label vanish."""
    import main
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")
    _decide(client, a["id"], 300, 1, "no")

    # Mark as classifying (mimicking what the endpoint does)
    label = session.get(LabelDefinition, a["id"])
    label.phase = "classifying"
    session.add(label)
    session.commit()

    # Force a failure path: patch classify_binary to raise
    from unittest.mock import patch as _patch

    def boom(*args, **kwargs):
        raise RuntimeError("Gemini quota exceeded")

    with _patch("binary_autolabel_service.classify_binary", side_effect=boom):
        # Run the same path the bg task would run, against the test session
        try:
            main._do_classification(session, label)
        except Exception as e:
            # Mirror the bg task's exception handler manually
            label.phase = "failed"
            import json as _json
            label.summary_json = _json.dumps({"error": str(e)})
            session.add(label)
            session.commit()

    items = client.get("/api/handoff-summaries").json()
    failed = [it for it in items if it["label_name"] == "help"]
    assert len(failed) == 1
    assert failed[0]["phase"] == "failed"
    assert failed[0]["error"] == "Gemini quota exceeded"
