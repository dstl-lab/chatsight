"""Tests for concept_service — embedding, clustering, discovery."""
import numpy as np
from unittest.mock import patch, MagicMock
from sqlmodel import select

from models import MessageEmbedding, ConceptCandidate, LabelDefinition


def _fake_embed_result(texts):
    """Return a mock Gemini embed response with deterministic 768-d vectors."""
    mock_result = MagicMock()
    mock_result.embeddings = []
    for i, _ in enumerate(texts):
        emb = MagicMock()
        emb.values = list(np.random.RandomState(i).rand(3072).astype(float))
        mock_result.embeddings.append(emb)
    return mock_result


@patch("concept_service.client")
def test_embed_messages_caches_results(mock_client, session):
    mock_client.models.embed_content.side_effect = (
        lambda **kwargs: _fake_embed_result(kwargs["contents"])
    )

    from concept_service import embed_messages

    messages = [
        {"chatlog_id": 1, "message_index": 0, "message_text": "How do I read a CSV?"},
        {"chatlog_id": 1, "message_index": 1, "message_text": "What is a DataFrame?"},
    ]
    vectors = embed_messages(messages, session)

    assert vectors.shape == (2, 3072)
    # Verify cached in DB
    cached = session.exec(select(MessageEmbedding)).all()
    assert len(cached) == 2

    # Second call should NOT hit the API
    mock_client.models.embed_content.reset_mock()
    vectors2 = embed_messages(messages, session)
    assert vectors2.shape == (2, 3072)
    mock_client.models.embed_content.assert_not_called()
    assert np.allclose(vectors, vectors2)


@patch("concept_service.client")
def test_discover_concepts_returns_candidates(mock_client, session):
    from concept_service import discover_concepts

    # Set up: one existing label
    session.add(LabelDefinition(name="Concept Probe", description="Student asks about a concept", sort_order=0))
    session.commit()

    # Mock embedding calls
    mock_client.models.embed_content.side_effect = (
        lambda **kwargs: _fake_embed_result(kwargs["contents"])
    )

    # Mock generative call for concept suggestion
    mock_fn_call = MagicMock()
    mock_fn_call.name = "suggest_concepts"
    mock_fn_call.args = {
        "concepts": [
            {
                "name": "Debugging Strategy",
                "description": "Student systematically tests hypotheses to find errors",
                "evidence": ["Let me try printing the output first", "What if I change this variable?"],
                "cluster_ids": [0, 2],
            }
        ]
    }
    mock_part = MagicMock()
    mock_part.function_call = mock_fn_call
    mock_response = MagicMock()
    mock_response.candidates = [MagicMock()]
    mock_response.candidates[0].content.parts = [mock_part]
    mock_client.models.generate_content.return_value = mock_response

    messages = [
        {"chatlog_id": i, "message_index": 0, "message_text": f"Message {i}"}
        for i in range(20)
    ]
    candidates = discover_concepts(messages, session, n_clusters=4, sample_per_cluster=3)

    assert len(candidates) == 1
    assert candidates[0].name == "Debugging Strategy"
    assert candidates[0].status == "pending"
    # Verify saved to DB
    saved = session.exec(select(ConceptCandidate)).all()
    assert len(saved) == 1
    # similar_to field should exist (value depends on random embeddings vs threshold)
    assert hasattr(candidates[0], "similar_to")


@patch("concept_service.client")
def test_deduplicate_concepts_filters_similar(mock_client):
    from concept_service import _deduplicate_concepts

    # Mock embeddings: first two very similar, third distinct
    mock_result = MagicMock()
    v1 = np.ones(3072, dtype=float)
    v2 = np.ones(3072, dtype=float) * 0.99 + np.random.RandomState(0).rand(3072) * 0.01
    v3 = np.random.RandomState(42).randn(3072).astype(float)
    mock_result.embeddings = [MagicMock(values=list(v)) for v in [v1, v2, v3]]
    mock_client.models.embed_content.return_value = mock_result

    concepts = [
        {"name": "code review", "description": "Student asks for code review"},
        {"name": "code check", "description": "Student asks to check their code"},
        {"name": "frustrated", "description": "Student expresses frustration"},
    ]
    result = _deduplicate_concepts(concepts, threshold=0.85)

    assert len(result) == 2
    assert result[0]["name"] == "code review"
    assert result[1]["name"] == "frustrated"
