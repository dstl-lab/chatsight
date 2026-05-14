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
