from binary_autolabel_service import CLASSIFY_FUNCTION_DECLARATION


def test_classify_binary_schema_includes_rationale_fields():
    """The Gemini function-calling schema must request matched_pattern and rationale
    per classification so the Summaries page can render per-message interpretability."""
    item_props = CLASSIFY_FUNCTION_DECLARATION["parameters"]["properties"]["classifications"]["items"]["properties"]

    assert "matched_pattern" in item_props
    assert item_props["matched_pattern"]["type"] == "string"

    assert "rationale" in item_props
    assert item_props["rationale"]["type"] == "string"


def test_classify_binary_required_fields_include_new_fields():
    required = CLASSIFY_FUNCTION_DECLARATION["parameters"]["properties"]["classifications"]["items"]["required"]
    assert "matched_pattern" in required
    assert "rationale" in required
