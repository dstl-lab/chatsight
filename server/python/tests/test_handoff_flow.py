"""Tests for handoff (now background-async), summary, refine, and review-queue endpoints."""
from datetime import datetime
from unittest.mock import MagicMock, patch

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


def test_parallel_classify_retries_on_rate_limit_then_succeeds(client, session):
    """The chunk runner retries Gemini 429 (RESOURCE_EXHAUSTED) errors with
    exponential backoff. After self-throttling below the quota, the run
    completes and AI rows are written normally."""
    _seed(session, conversations=2, per_conv=3)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")
    _decide(client, a["id"], 300, 1, "no")

    # Fail twice with 429, then succeed. Counters are per-call so any of the
    # parallel chunks share the same rate-limit emulation.
    call_count = {"n": 0}

    class _RateLimited(Exception):
        code = 429

    def flaky_classify(label_name, label_description, yes_examples, no_examples, messages):
        call_count["n"] += 1
        if call_count["n"] <= 2:
            raise _RateLimited("429 RESOURCE_EXHAUSTED: quota exceeded")
        return [
            {"index": i, "value": "yes" if i % 2 == 0 else "no", "confidence": 0.9}
            for i in range(len(messages))
        ]

    def fake_summary(*args, **kwargs):
        return {"included": [], "excluded": []}

    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=flaky_classify), \
         patch("binary_autolabel_service.summarize_batch", side_effect=fake_summary), \
         patch("main.time.sleep"):  # collapse backoff sleeps in tests
        main._do_classification(session, label)

    # Two 429s burned, then succeeded → AI rows landed normally.
    assert call_count["n"] >= 3
    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) > 0


def test_parallel_classify_gives_up_after_max_retries_on_rate_limit(client, session):
    """If 429s keep coming past PARALLEL_RETRY_MAX_ATTEMPTS, the chunk runner
    surfaces the 429 to the caller. The exception handler in
    `_classify_in_background` then marks the label rate_limited."""
    _seed(session, conversations=1, per_conv=2)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")

    def always_429(*args, **kwargs):
        raise Exception("429 RESOURCE_EXHAUSTED: quota exceeded")

    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=always_429), \
         patch("main.time.sleep"):
        import pytest as _pytest
        with _pytest.raises(Exception, match="429"):
            main._do_classification(session, label)


def test_parallel_classify_retries_on_request_timeout(client, session):
    """Hung connections (read/connect timeouts) are now treated as transient
    and retried, matching the rate-limit retry path. This prevents a single
    stuck socket from killing an otherwise-complete run (we hit exactly this
    at 99.7% on a 17k-message handoff)."""
    _seed(session, conversations=2, per_conv=3)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")
    _decide(client, a["id"], 300, 1, "no")

    # First two calls raise a timeout-flavored exception; third succeeds.
    call_count = {"n": 0}

    class _ReadTimeout(Exception):
        pass

    def flaky_classify(label_name, label_description, yes_examples, no_examples, messages):
        call_count["n"] += 1
        if call_count["n"] <= 2:
            raise _ReadTimeout("read timeout while waiting for Gemini response")
        return [
            {"index": i, "value": "no", "confidence": 0.5}
            for i in range(len(messages))
        ]

    def fake_summary(*args, **kwargs):
        return {"included": [], "excluded": []}

    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=flaky_classify), \
         patch("binary_autolabel_service.summarize_batch", side_effect=fake_summary), \
         patch("main.time.sleep"):
        main._do_classification(session, label)

    # Burned 2 timeouts then succeeded.
    assert call_count["n"] >= 3
    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) > 0


def test_parallel_classify_does_not_retry_non_rate_limit_errors(client, session):
    """Non-429 errors (auth, 500, validation, etc.) should NOT be retried —
    the chunk runner fails fast so genuine bugs surface immediately."""
    _seed(session, conversations=1, per_conv=2)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    _decide(client, a["id"], 300, 0, "yes")

    call_count = {"n": 0}

    def auth_error(*args, **kwargs):
        call_count["n"] += 1
        raise Exception("401 UNAUTHENTICATED: bad API key")

    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=auth_error), \
         patch("main.time.sleep"):
        import pytest as _pytest
        with _pytest.raises(Exception, match="401"):
            main._do_classification(session, label)
    # No retry burned on non-429 errors. With PARALLEL_CONCURRENCY=3 we may
    # have up to 3 chunks failing concurrently, but each chunk should fail
    # on its first attempt — call_count == number of chunks attempted, not
    # number of chunks × retry attempts.
    assert call_count["n"] <= main.PARALLEL_CONCURRENCY


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


def test_classification_total_is_cumulative_across_retries(client, session):
    """Regression: classified_count / classification_total must accumulate across
    retry-handoff. A partial run (some AI rows written, then crash → phase='failed')
    followed by a successful retry must end with counters that reflect *every*
    AI row for the label, not just the retry's portion. Previously retry-handoff
    cleared both counters and the second _do_classification would set
    classification_total to len(pending), undercounting the cumulative work."""
    _seed(session, conversations=4, per_conv=3)  # 12 cached messages
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    # Simulate a partial first run: 5 AI rows already on disk, label marked failed.
    partial_keys = [(300, 0), (300, 1), (300, 2), (301, 0), (301, 1)]
    for cid, midx in partial_keys:
        session.add(LabelApplication(
            label_id=a["id"],
            chatlog_id=cid,
            message_index=midx,
            applied_by="ai",
            confidence=0.9,
            value="yes",
        ))
    label = session.get(LabelDefinition, a["id"])
    label.phase = "failed"
    label.is_active = False
    label.classified_count = 5
    label.classification_total = 5  # what the failed first run had written
    session.add(label)
    session.commit()

    # Retry: counters must survive — they're cumulative.
    r = client.post(f"/api/single-labels/{a['id']}/retry-handoff")
    assert r.status_code == 200
    after_retry = session.get(LabelDefinition, a["id"])
    session.refresh(after_retry)
    assert after_retry.classified_count == 5
    assert after_retry.classification_total == 5

    # Execute the retry's classification. 12 cached − 5 already-classified = 7 pending.
    _run_classification(session, a["id"])

    final = session.get(LabelDefinition, a["id"])
    session.refresh(final)
    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) == 12
    assert final.classification_total == 12  # 5 prior + 7 new
    assert final.classified_count == 12


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


# ─── Batch API instrumentation ────────────────────────────────────────────


def _make_fake_job(state_name, name="batches/test-job", dest_inlined=None):
    """Build a MagicMock job mimicking the genai Batch API shape that
    `_classify_via_batch_api` reads from."""
    j = MagicMock()
    j.name = name
    j.state.name = state_name
    j.error = None
    if dest_inlined is not None:
        j.dest.file_name = None
        j.dest.inlined_responses = dest_inlined
    else:
        j.dest = None
    return j


def test_batch_state_persists_through_poll_loop_and_clears_on_success(session):
    """The batch path writes `batch_state` + `batch_polled_at` on every poll
    tick (so the UI can show real liveness) and nulls the in-flight fields
    once the job terminates successfully. `batch_submitted_at` is kept as a
    historical record."""
    import binary_autolabel_service as bas

    label = LabelDefinition(name="batch-test", mode="single", phase="classifying")
    session.add(label)
    session.commit()
    session.refresh(label)

    pending = [(1, i, f"msg {i}") for i in range(3)]
    states_after_create = iter(["JOB_STATE_RUNNING", "JOB_STATE_SUCCEEDED"])
    snapshots: list[str] = []

    def fake_get(name=None):
        # Snapshot what the function just committed before serving the next state.
        session.refresh(label)
        snapshots.append(label.batch_state)
        return _make_fake_job(
            next(states_after_create),
            dest_inlined=[],  # parse_classify_batch_response is patched, so contents irrelevant
        )

    fake_client = MagicMock()
    fake_client.files.upload.return_value = MagicMock(name="uploads/x")
    fake_client.files.delete = MagicMock()
    fake_client.batches.create.return_value = _make_fake_job("JOB_STATE_PENDING")
    fake_client.batches.get.side_effect = fake_get

    fake_classifications = [
        {"index": i, "value": "yes", "confidence": 0.9} for i in range(len(pending))
    ]

    with patch.object(bas, "client", fake_client), \
         patch("main.time.sleep"), \
         patch.object(bas, "parse_classify_batch_response", return_value=fake_classifications):
        main._classify_via_batch_api(session, label, pending, [], [])

    session.refresh(label)
    # In-flight handle was nulled after terminal completion.
    assert label.batch_job_name is None
    assert label.batch_state is None
    assert label.batch_polled_at is None
    assert label.batch_total_count is None
    assert label.batch_completed_count is None
    # Historical record survives.
    assert label.batch_submitted_at is not None
    # The loop committed at least one intermediate state between submit and
    # success — snapshots[0] should be what was committed by `create()` (PENDING),
    # snapshots[1] should be what was committed after the first `get()` (RUNNING).
    assert snapshots[0] == "JOB_STATE_PENDING"
    assert snapshots[1] == "JOB_STATE_RUNNING"
    # And the post-batch result-write loop populated the row count.
    assert label.classified_count == len(pending)


def test_batch_state_cleared_when_background_task_raises(session, engine):
    """When the background classification raises, the failure handler in
    `_classify_in_background` clears the in-flight batch handle so the
    failed-state UI doesn't render a stale 'running' badge.
    `batch_submitted_at` is intentionally preserved for postmortems."""
    label = LabelDefinition(
        name="batch-fail",
        mode="single",
        phase="classifying",
        batch_job_name="batches/inflight",
        batch_state="JOB_STATE_RUNNING",
        batch_submitted_at=datetime.utcnow(),
        batch_polled_at=datetime.utcnow(),
    )
    session.add(label)
    session.commit()
    session.refresh(label)
    label_id = label.id

    def boom(*args, **kwargs):
        raise RuntimeError("Gemini batch died")

    # `_classify_in_background` opens its own Session(engine). Point it at the
    # in-memory test engine so the cleanup commit lands in the test DB.
    with patch.object(main, "engine", engine), \
         patch("main._do_classification", side_effect=boom):
        main._classify_in_background(label_id)

    session.expire_all()
    fresh = session.get(LabelDefinition, label_id)
    assert fresh.phase == "failed"
    assert fresh.batch_job_name is None
    assert fresh.batch_state is None
    assert fresh.batch_polled_at is None
    # Historical record preserved.
    assert fresh.batch_submitted_at is not None


def test_handoff_summaries_includes_batch_fields(client, session):
    """`/api/handoff-summaries` surfaces `batch_state`, `batch_submitted_at`,
    and `batch_polled_at` so the SummariesPage can render the in-flight
    state-aware display."""
    label = LabelDefinition(
        name="batch-flight",
        mode="single",
        phase="classifying",
        classification_total=1234,
        classified_count=0,
        batch_job_name="batches/abc",
        batch_state="JOB_STATE_RUNNING",
        batch_submitted_at=datetime.utcnow(),
        batch_polled_at=datetime.utcnow(),
    )
    session.add(label)
    session.commit()

    items = client.get("/api/handoff-summaries").json()
    found = [it for it in items if it["label_name"] == "batch-flight"]
    assert len(found) == 1
    item = found[0]
    assert item["batch_state"] == "JOB_STATE_RUNNING"
    assert item["batch_submitted_at"] is not None
    assert item["batch_polled_at"] is not None


def test_handoff_summaries_omits_batch_fields_when_not_in_flight(client, session):
    """A label that never used the batch path (or whose batch has terminated)
    surfaces `batch_state` as None — the frontend uses presence-of-state to
    decide whether to render the indeterminate UI."""
    label = LabelDefinition(
        name="no-batch", mode="single", phase="classifying",
        classification_total=10, classified_count=3,
    )
    session.add(label)
    session.commit()

    items = client.get("/api/handoff-summaries").json()
    found = [it for it in items if it["label_name"] == "no-batch"]
    assert len(found) == 1
    assert found[0]["batch_state"] is None
    assert found[0]["batch_submitted_at"] is None
    assert found[0]["batch_polled_at"] is None


# ─── Multi-batch splitting ────────────────────────────────────────────────


def _make_multi_batch_fakes(state_sequences):
    """Build the standard mock client used by the multi-batch tests.
    `state_sequences` maps job name -> list of states returned by successive
    .get() calls on that job. Each .create() call returns a new PENDING job
    named `batches/sb-{idx}` in order, matching the sb_idx assignment in
    `_classify_via_batch_api`."""
    create_count = {"n": 0}
    upload_count = {"n": 0}

    def fake_create(*, model=None, src=None, config=None):
        idx = create_count["n"]
        create_count["n"] += 1
        return _make_fake_job("JOB_STATE_PENDING", name=f"batches/sb-{idx}")

    state_iters = {name: iter(seq) for name, seq in state_sequences.items()}

    def fake_get(name=None):
        next_state = next(state_iters[name])
        return _make_fake_job(
            next_state,
            name=name,
            dest_inlined=[] if next_state == "JOB_STATE_SUCCEEDED" else None,
        )

    def fake_upload(*, file=None, config=None):
        idx = upload_count["n"]
        upload_count["n"] += 1
        m = MagicMock()
        m.name = f"uploads/file-{idx}"
        return m

    fake_client = MagicMock()
    fake_client.files.upload.side_effect = fake_upload
    fake_client.files.delete = MagicMock()
    fake_client.batches.create.side_effect = fake_create
    fake_client.batches.get.side_effect = fake_get
    return fake_client, create_count, upload_count


def test_multi_batch_path_advances_counts_as_sub_batches_land(session):
    """When pending > BATCH_SPLIT_TARGET_MESSAGES, the batch path splits work
    across N sub-batches; `classified_count` + `batch_completed_count` advance
    as each one terminates SUCCEEDED rather than waiting for the whole job."""
    import binary_autolabel_service as bas

    label = LabelDefinition(name="multi-batch", mode="single", phase="classifying")
    session.add(label)
    session.commit()
    session.refresh(label)

    # 8000 pending msgs → 160 chunks of 50 → N=2 sub-batches (target 4000 each).
    pending = [(1, i, f"msg {i}") for i in range(8000)]

    fake_client, create_count, _ = _make_multi_batch_fakes({
        # Tick 1: both still running. Tick 2: sb-0 succeeds, sb-1 still running.
        # Tick 3: sb-1 succeeds.
        "batches/sb-0": ["JOB_STATE_RUNNING", "JOB_STATE_SUCCEEDED"],
        "batches/sb-1": ["JOB_STATE_RUNNING", "JOB_STATE_RUNNING", "JOB_STATE_SUCCEEDED"],
    })

    # Snapshot DB state BEFORE each tick (time.sleep is patched and runs first).
    tick_snapshots: list[dict] = []

    def fake_sleep(_seconds):
        session.refresh(label)
        tick_snapshots.append({
            "classified_count": label.classified_count,
            "batch_completed_count": label.batch_completed_count,
            "batch_total_count": label.batch_total_count,
            "batch_state": label.batch_state,
        })

    fake_classifications = lambda _resp, n: [
        {"index": i, "value": "yes", "confidence": 0.9} for i in range(n)
    ]

    with patch.object(bas, "client", fake_client), \
         patch("main.time.sleep", side_effect=fake_sleep), \
         patch.object(bas, "parse_classify_batch_response", side_effect=fake_classifications):
        main._classify_via_batch_api(session, label, pending, [], [])

    session.refresh(label)
    # Two sub-batches were created and both succeeded.
    assert create_count["n"] == 2
    assert label.classified_count == 8000
    # All in-flight handles cleared after terminal.
    assert label.batch_job_name is None
    assert label.batch_state is None
    assert label.batch_polled_at is None
    assert label.batch_total_count is None
    assert label.batch_completed_count is None
    assert label.batch_submitted_at is not None

    # Intermediate progress: classified_count is monotonically non-decreasing
    # across ticks, and crosses 0 → ~4000 → 8000 as each sub-batch lands.
    classified_series = [s["classified_count"] or 0 for s in tick_snapshots]
    assert classified_series == sorted(classified_series)
    # At least one tick observed partial progress (the first sub-batch landed
    # while the second was still in flight). Sequence is roughly [0, 4000, ...].
    assert any(0 < (s["classified_count"] or 0) < 8000 for s in tick_snapshots)
    # batch_total_count is set immediately after submission, so every snapshot
    # within the in-flight period reports it.
    assert all(s["batch_total_count"] == 2 for s in tick_snapshots)
    # At least one tick observed `batch_completed_count == 1` (between the
    # first and second sub-batch landings). The final state of 2 lives only
    # between the last poll and the post-loop cleanup, so we don't observe it
    # in tick_snapshots — the after-loop `assert label.batch_completed_count
    # is None` above already verifies the terminal cleanup.
    assert any((s["batch_completed_count"] or 0) == 1 for s in tick_snapshots)


def test_multi_batch_partial_failure_preserves_succeeded_sub_batch_rows(session):
    """If one sub-batch hits a non-SUCCEEDED terminal, the batch function
    raises. Already-committed AI rows from sibling sub-batches that succeeded
    earlier stay in the DB so the retry path picks up from there via the
    `(label_id, chatlog_id, message_index)` unique constraint."""
    import binary_autolabel_service as bas

    label = LabelDefinition(name="multi-partial-fail", mode="single", phase="classifying")
    session.add(label)
    session.commit()
    session.refresh(label)

    pending = [(1, i, f"msg {i}") for i in range(8000)]

    fake_client, _, _ = _make_multi_batch_fakes({
        # Tick 1: sb-0 succeeds, sb-1 still running.
        # Tick 2: sb-1 fails.
        "batches/sb-0": ["JOB_STATE_SUCCEEDED"],
        "batches/sb-1": ["JOB_STATE_RUNNING", "JOB_STATE_FAILED"],
    })

    fake_classifications = lambda _resp, n: [
        {"index": i, "value": "yes", "confidence": 0.9} for i in range(n)
    ]

    with patch.object(bas, "client", fake_client), \
         patch("main.time.sleep"), \
         patch.object(bas, "parse_classify_batch_response", side_effect=fake_classifications):
        import pytest as _pytest
        with _pytest.raises(RuntimeError, match="JOB_STATE_FAILED"):
            main._classify_via_batch_api(session, label, pending, [], [])

    # The successful sub-batch's AI rows are still in the DB.
    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == label.id,
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) > 0
    # And the label's classified_count reflects the partial work.
    session.refresh(label)
    assert label.classified_count is not None and label.classified_count > 0


def test_n_eq_1_path_when_pending_at_or_below_split_target(session):
    """For pending ≤ BATCH_SPLIT_TARGET_MESSAGES the splitter produces a single
    sub-batch (N=1), keeping the small-handoff path behaviorally identical to
    the pre-split version. Exercises `_group_chunks_into_sub_batches` boundary."""
    import binary_autolabel_service as bas

    label = LabelDefinition(name="n1-path", mode="single", phase="classifying")
    session.add(label)
    session.commit()
    session.refresh(label)

    # Exactly at the target — should still be 1 sub-batch.
    pending = [(1, i, f"msg {i}") for i in range(main.BATCH_SPLIT_TARGET_MESSAGES)]

    fake_client, create_count, _ = _make_multi_batch_fakes({
        "batches/sb-0": ["JOB_STATE_SUCCEEDED"],
    })

    fake_classifications = lambda _resp, n: [
        {"index": i, "value": "yes", "confidence": 0.9} for i in range(n)
    ]

    with patch.object(bas, "client", fake_client), \
         patch("main.time.sleep"), \
         patch.object(bas, "parse_classify_batch_response", side_effect=fake_classifications):
        main._classify_via_batch_api(session, label, pending, [], [])

    # Single sub-batch was created.
    assert create_count["n"] == 1
    session.refresh(label)
    assert label.classified_count == main.BATCH_SPLIT_TARGET_MESSAGES


def test_handoff_summaries_surfaces_batch_count_fields(client, session):
    """`/api/handoff-summaries` exposes `batch_total_count` and
    `batch_completed_count` so the UI can render 'X of N batches done'."""
    label = LabelDefinition(
        name="batch-counts",
        mode="single",
        phase="classifying",
        classification_total=17416,
        classified_count=8000,
        batch_state="JOB_STATE_RUNNING",
        batch_submitted_at=datetime.utcnow(),
        batch_polled_at=datetime.utcnow(),
        batch_total_count=5,
        batch_completed_count=2,
    )
    session.add(label)
    session.commit()

    items = client.get("/api/handoff-summaries").json()
    found = [it for it in items if it["label_name"] == "batch-counts"]
    assert len(found) == 1
    assert found[0]["batch_total_count"] == 5
    assert found[0]["batch_completed_count"] == 2
