"""Verify that the AI-row persistence sites in main.py thread matched_pattern
and rationale through from binary_autolabel_service into LabelApplication rows."""
from unittest.mock import patch
from sqlmodel import select
from models import LabelDefinition, LabelApplication, MessageCache


def test_binary_classify_persistence_includes_new_fields(session):
    """Call _do_classification directly (bypasses BackgroundTasks) with a
    stubbed classify_binary that returns matched_pattern and rationale, then
    verify those fields are written to the LabelApplication row."""
    label = LabelDefinition(
        name="self-correction",
        description="catches own mistake",
        mode="single",
        phase="labeling",
        is_active=True,
    )
    session.add(label)
    session.add(MessageCache(chatlog_id=1, message_index=0, message_text="wait, I misread"))
    session.commit()
    session.refresh(label)

    fake_classifications = [{
        "index": 0,
        "value": "yes",
        "confidence": 0.62,
        "matched_pattern": "questioning own work",
        "rationale": "Student recognizes they misread.",
    }]

    # Patch at the module level that main.py imports from.
    with patch("binary_autolabel_service.classify_binary", return_value=fake_classifications), \
         patch("binary_autolabel_service.summarize_batch", return_value={"patterns": []}):
        from main import _do_classification
        _do_classification(session, label, sample_size=1)

    row = session.exec(
        select(LabelApplication)
        .where(LabelApplication.label_id == label.id)
        .where(LabelApplication.applied_by == "ai")
    ).first()

    assert row is not None, "Expected an AI LabelApplication row to be created"
    assert row.matched_pattern == "questioning own work"
    assert row.rationale == "Student recognizes they misread."
    assert row.value == "yes"
    assert abs(row.confidence - 0.62) < 1e-6


def test_parse_and_write_sub_batch_persists_new_fields(session):
    """The batch-path persistence helper (_parse_and_write_sub_batch) must also
    thread matched_pattern + rationale through to the LabelApplication row, not
    just the sync path."""
    from types import SimpleNamespace
    from models import LabelDefinition, LabelApplication, MessageCache
    from sqlmodel import select
    from main import _parse_and_write_sub_batch

    label = LabelDefinition(
        name="self-correction",
        description="catches own mistake",
        mode="single",
        phase="labeling",
        is_active=True,
    )
    session.add(label)
    session.add(MessageCache(chatlog_id=42, message_index=0, message_text="wait, I misread"))
    session.commit()
    session.refresh(label)

    # Build a fake `job` whose dest has inlined_responses (avoids file download).
    inline = SimpleNamespace(key="chunk-0", response=None, error=None)
    job = SimpleNamespace(dest=SimpleNamespace(file_name=None, inlined_responses=[inline]))

    # entry mirrors what _classify_via_batch_api builds:
    # chunks is a list of chunk-lists; each chunk is a list of (cid, midx, text) tuples.
    entry = {
        "chunks": [[(42, 0, "wait, I misread")]],
        "start_chunk_idx": 0,
    }

    # Fake bas: parse_classify_batch_response returns our controlled classification.
    fake_cls = [{
        "index": 0,
        "value": "yes",
        "confidence": 0.62,
        "matched_pattern": "questioning own work",
        "rationale": "Student recognizes they misread.",
    }]
    bas = SimpleNamespace(
        parse_classify_batch_response=lambda response_obj, n: fake_cls,
        client=None,
    )

    _parse_and_write_sub_batch(session, label, job, entry, bas)
    session.commit()

    row = session.exec(
        select(LabelApplication)
        .where(LabelApplication.label_id == label.id)
        .where(LabelApplication.applied_by == "ai")
    ).first()

    assert row is not None, "expected an AI row to be written"
    assert row.matched_pattern == "questioning own work"
    assert row.rationale.startswith("Student recognizes")
    assert row.value == "yes"
    assert abs(row.confidence - 0.62) < 1e-6
