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


def test_pair_text_with_context():
    from concept_service import _build_pair_text
    out = _build_pair_text({
        "message_text": "yes",
        "context_before": "Did that solve it?",
    })
    assert out == "Tutor: Did that solve it?\nStudent: yes"


def test_pair_text_without_context():
    from concept_service import _build_pair_text
    out = _build_pair_text({
        "message_text": "yes",
        "context_before": None,
    })
    assert out == "[Conversation start]\nStudent: yes"


def test_pair_text_treats_empty_context_as_missing():
    from concept_service import _build_pair_text
    out = _build_pair_text({
        "message_text": "yes",
        "context_before": "",
    })
    assert out == "[Conversation start]\nStudent: yes"


def test_pair_text_truncates_long_context():
    from concept_service import _build_pair_text, CONTEXT_CHAR_LIMIT
    long_ctx = "A" * 800 + "tail-marker"
    out = _build_pair_text({
        "message_text": "yes",
        "context_before": long_ctx,
    })
    # Truncation keeps the LAST CONTEXT_CHAR_LIMIT chars (where the prompt usually lives).
    assert "tail-marker" in out
    assert out.startswith("Tutor: ")
    # The Tutor segment should be exactly CONTEXT_CHAR_LIMIT chars.
    tutor_line = out.split("\n")[0]  # "Tutor: <ctx>"
    assert len(tutor_line) - len("Tutor: ") == CONTEXT_CHAR_LIMIT


def test_pair_text_handles_missing_context_key():
    """If the caller dict lacks `context_before` entirely (legacy path), fall back gracefully."""
    from concept_service import _build_pair_text
    out = _build_pair_text({"message_text": "hello"})
    assert out == "[Conversation start]\nStudent: hello"


def test_pair_text_treats_whitespace_only_context_as_missing():
    """Whitespace-only context (spaces, newlines, tabs) should be treated as missing."""
    from concept_service import _build_pair_text
    out = _build_pair_text({
        "message_text": "yes",
        "context_before": "   \n  ",
    })
    assert out == "[Conversation start]\nStudent: yes"


@patch("concept_service.client")
def test_embed_messages_sends_pair_text_to_api(mock_client, session):
    """The string passed to the embedding API must be the pair format, not the bare student text."""
    mock_client.models.embed_content.side_effect = (
        lambda **kwargs: _fake_embed_result(kwargs["contents"])
    )

    from concept_service import embed_messages

    messages = [
        {
            "chatlog_id": 1,
            "message_index": 0,
            "message_text": "yes",
            "context_before": "Did that solve it?",
        },
    ]
    embed_messages(messages, session)

    # The API was called once. Inspect the contents argument.
    call = mock_client.models.embed_content.call_args
    assert call is not None
    contents = call.kwargs["contents"]
    assert contents == ["Tutor: Did that solve it?\nStudent: yes"]


@patch("concept_service.client")
def test_embed_messages_uses_new_model_version_as_cache_key(mock_client, session):
    """Cached MessageEmbedding rows must use the bumped model_version (not the raw API model)."""
    mock_client.models.embed_content.side_effect = (
        lambda **kwargs: _fake_embed_result(kwargs["contents"])
    )

    from concept_service import embed_messages, EMBED_MODEL

    messages = [
        {"chatlog_id": 1, "message_index": 0, "message_text": "hi", "context_before": "Hello."},
    ]
    embed_messages(messages, session)

    cached = session.exec(select(MessageEmbedding)).all()
    assert len(cached) == 1
    assert cached[0].model_version == EMBED_MODEL
    assert EMBED_MODEL == "gemini-embedding-001:pair-v1"


@patch("concept_service.client")
def test_embed_messages_does_not_reuse_old_key_cache(mock_client, session):
    """A pre-existing row stored under the OLD model_version must NOT short-circuit the new flow."""
    mock_client.models.embed_content.side_effect = (
        lambda **kwargs: _fake_embed_result(kwargs["contents"])
    )

    # Pre-seed a stale-key row.
    session.add(MessageEmbedding(
        chatlog_id=1,
        message_index=0,
        embedding=np.zeros(3072, dtype=np.float32).tobytes(),
        model_version="gemini-embedding-001",  # old key
    ))
    session.commit()

    from concept_service import embed_messages, EMBED_MODEL

    messages = [
        {"chatlog_id": 1, "message_index": 0, "message_text": "hi", "context_before": "Hello."},
    ]
    embed_messages(messages, session)

    # API was called (cache miss under new key).
    assert mock_client.models.embed_content.called

    # We now have two rows: the stale-key row (preserved) and a new-key row.
    rows = session.exec(select(MessageEmbedding)).all()
    versions = sorted(r.model_version for r in rows)
    assert versions == ["gemini-embedding-001", EMBED_MODEL]


def test_discovery_prompt_includes_tutor_context_when_present():
    from concept_service import _build_discovery_prompt

    samples_by_cluster = {
        0: [
            {
                "message_text": "yes",
                "context_before": "Did that solve it?",
            },
            {
                "message_text": "?",
                "context_before": "What would go in the blank to make this statement true?",
            },
        ],
    }
    prompt = _build_discovery_prompt(samples_by_cluster, existing_labels=[], rejected_names=[])

    # When context is present, the prompt shows BOTH tutor and student turns.
    assert "Tutor asked:" in prompt
    assert "Student replied:" in prompt
    assert "Did that solve it?" in prompt
    assert "What would go in the blank to make this statement true?" in prompt


def test_discovery_prompt_handles_missing_context():
    from concept_service import _build_discovery_prompt

    samples_by_cluster = {
        0: [
            {"message_text": "hello", "context_before": None},
        ],
    }
    prompt = _build_discovery_prompt(samples_by_cluster, existing_labels=[], rejected_names=[])

    # When no context, the prompt marks this as the start of the conversation.
    assert "(start of conversation)" in prompt
    assert "hello" in prompt
    # The "Tutor asked:" prefix must NOT appear for this sample.
    # (There may be other samples in other clusters that legitimately have it, but here there's just one sample.)
    assert "Tutor asked:" not in prompt
