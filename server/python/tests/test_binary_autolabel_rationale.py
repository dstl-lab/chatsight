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


from binary_autolabel_service import parse_classify_batch_response


def test_parse_classify_batch_response_propagates_new_fields():
    """The batch-path parser must propagate matched_pattern and rationale
    so they can be persisted to LabelApplication rows."""
    fake = {
        "candidates": [{
            "content": {
                "parts": [{
                    "functionCall": {
                        "name": "classify_binary",
                        "args": {"classifications": [
                            {"index": 0, "value": "yes", "confidence": 0.62,
                             "matched_pattern": "questioning own work",
                             "rationale": "Student recognizes misread."},
                        ]},
                    }
                }]
            }
        }]
    }
    out = parse_classify_batch_response(fake, num_messages=1)
    assert len(out) == 1
    assert out[0]["matched_pattern"] == "questioning own work"
    assert out[0]["rationale"].startswith("Student recognizes")


def test_parse_classify_batch_response_fills_missing_with_none():
    """When the batch response lacks a classification for an index, the parser
    fills matched_pattern / rationale with None (not absent keys)."""
    fake = {"candidates": [{"content": {"parts": []}}]}
    out = parse_classify_batch_response(fake, num_messages=2)
    assert len(out) == 2
    for row in out:
        assert row["matched_pattern"] is None
        assert row["rationale"] is None
