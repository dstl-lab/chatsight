"""Tests for concept_generation module — RAG-style prompts."""
from unittest.mock import MagicMock


def test_generate_broad_labels_resolves_evidence_back_to_message_ids(monkeypatch):
    """Verify the prompt encodes breadth constraints, the function-call
    response is parsed, and evidence indices are resolved back to
    {chatlog_id, message_index} pairs."""
    captured: dict = {}

    fake_part = MagicMock()
    fake_part.function_call.name = "suggest_broad_labels"
    fake_part.function_call.args = {
        "concepts": [
            {
                "name": "metacognition",
                "description": "students reflecting on their own learning",
                "evidence_message_indices": [0, 3],
            }
        ]
    }
    fake_response = MagicMock()
    fake_response.candidates = [MagicMock()]
    fake_response.candidates[0].content.parts = [fake_part]

    def fake_generate(model=None, contents=None, config=None):
        captured["prompt"] = contents
        return fake_response

    fake_client = MagicMock()
    fake_client.models.generate_content.side_effect = fake_generate
    monkeypatch.setattr("concept_generation.client", fake_client)

    from concept_generation import generate_broad_labels

    retrieved = [
        {"chatlog_id": 1, "message_index": 0, "message_text": "I'm not sure if I get this"},
        {"chatlog_id": 1, "message_index": 1, "message_text": "code didn't run"},
        {"chatlog_id": 1, "message_index": 2, "message_text": "what does .loc do"},
        {"chatlog_id": 1, "message_index": 3, "message_text": "am I doing this right"},
    ]
    drafts = generate_broad_labels(retrieved, existing_labels=[], rejected_names=[])

    assert len(drafts) == 1
    assert drafts[0]["kind"] == "broad_label"
    assert drafts[0]["name"] == "metacognition"
    assert {"chatlog_id": 1, "message_index": 0} in drafts[0]["evidence_message_ids"]
    assert {"chatlog_id": 1, "message_index": 3} in drafts[0]["evidence_message_ids"]

    # Prompt must include the breadth constraint.
    prompt = captured["prompt"]
    assert "co-apply" in prompt.lower() or "combine" in prompt.lower()
    assert "broad" in prompt.lower()


def test_broad_label_tool_schema_shape():
    from concept_generation import BROAD_LABEL_TOOL
    decl = BROAD_LABEL_TOOL.function_declarations[0]
    assert decl.name == "suggest_broad_labels"
    # The genai SDK wraps `parameters` as a Schema. Drill via attribute
    # access rather than dict subscript.
    concepts_schema = decl.parameters.properties["concepts"]
    item_schema = concepts_schema.items
    item_props = item_schema.properties
    assert "name" in item_props
    assert "description" in item_props
    assert "evidence_message_indices" in item_props


def test_generate_co_occurrence_returns_drafts(monkeypatch):
    fake_part = MagicMock()
    fake_part.function_call.name = "evaluate_co_occurrence"
    fake_part.function_call.args = {
        "evaluations": [
            {
                "label_a_id": 1, "label_b_id": 2,
                "name": "stuck on code",
                "description": "students who cannot run their code and feel stuck",
                "suggested_resolution": "make_label",
            }
        ]
    }
    fake_response = MagicMock()
    fake_response.candidates = [MagicMock()]
    fake_response.candidates[0].content.parts = [fake_part]

    fake_client = MagicMock()
    fake_client.models.generate_content = MagicMock(return_value=fake_response)
    monkeypatch.setattr("concept_generation.client", fake_client)

    from concept_generation import generate_co_occurrence_concepts

    pairs = [{
        "label_a_id": 1, "label_b_id": 2,
        "label_a_name": "code help", "label_b_name": "confused",
        "count": 12,
        "example_message_ids": [{"chatlog_id": 1, "message_index": 0}],
    }]
    drafts = generate_co_occurrence_concepts(pairs, existing_labels=[])

    assert len(drafts) == 1
    assert drafts[0]["kind"] == "co_occurrence"
    assert drafts[0]["co_occurrence_label_ids"] == [1, 2]
    assert drafts[0]["co_occurrence_count"] == 12
    assert drafts[0]["suggested_resolution"] == "make_label"


def test_co_occurrence_tool_schema_shape():
    from concept_generation import CO_OCCURRENCE_TOOL
    decl = CO_OCCURRENCE_TOOL.function_declarations[0]
    assert decl.name == "evaluate_co_occurrence"
    item_props = decl.parameters.properties["evaluations"].items.properties
    assert {"label_a_id", "label_b_id", "suggested_resolution"} <= set(item_props)
