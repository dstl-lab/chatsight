import pytest
from unittest.mock import MagicMock, patch


def _emb(values):
    e = MagicMock()
    e.values = values
    return e


def _mock_embed(*batches):
    """Return a mock embed_content that yields embeddings from `batches` in order."""
    responses = []
    for vecs in batches:
        r = MagicMock()
        r.embeddings = [_emb(v) for v in vecs]
        responses.append(r)
    m = MagicMock(side_effect=responses)
    return m


# ── _cosine_sim ──────────────────────────────────────────────────────────────

def test_cosine_sim_identical_vectors():
    from name_suggestion_service import _cosine_sim
    assert _cosine_sim([1.0, 0.0, 0.0], [1.0, 0.0, 0.0]) == pytest.approx(1.0)


def test_cosine_sim_orthogonal_vectors():
    from name_suggestion_service import _cosine_sim
    assert _cosine_sim([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]) == pytest.approx(0.0)


def test_cosine_sim_zero_vector_returns_zero():
    from name_suggestion_service import _cosine_sim
    assert _cosine_sim([0.0, 0.0, 0.0], [1.0, 0.0, 0.0]) == 0.0


# ── filter_suggestions ───────────────────────────────────────────────────────

def test_filter_removes_synonym(monkeypatch):
    """'puzzled' should be filtered when 'confusion' exists (cos_sim ≈ 0.99 > 0.75)."""
    import name_suggestion_service as svc

    # candidates: ["puzzled", "code syntax help"], existing: ["confusion"]
    mock = _mock_embed(
        [[0.99, 0.14, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]],
    )
    with patch.object(svc.client.models, "embed_content", mock):
        result = svc.filter_suggestions(
            candidate_names=["puzzled", "code syntax help"],
            candidate_descriptions=["lost student", "syntax questions"],
            existing_names=["confusion"],
        )

    names = [r["name"] for r in result]
    assert "puzzled" not in names          # cos([0.99,0.14,0],[1,0,0]) ≈ 0.99 > 0.75
    assert "code syntax help" in names     # cos([0,0,1],[1,0,0]) = 0.0 < 0.75


def test_filter_returns_all_when_no_existing_labels():
    import name_suggestion_service as svc
    with patch.object(svc.client.models, "embed_content") as mock_embed:
        result = svc.filter_suggestions(
            candidate_names=["error tracing"],
            candidate_descriptions=["tracing errors"],
            existing_names=[],
        )
    assert result == [{"name": "error tracing", "description": "tracing errors"}]
    mock_embed.assert_not_called()


def test_filter_keeps_candidate_at_exact_threshold(monkeypatch):
    """Candidate with sim == 0.75 must be kept (threshold is strictly >)."""
    import math
    import name_suggestion_service as svc

    # cos_sim(a, b) = 0.75 when a=[0.75, sqrt(1-0.75^2), 0], b=[1,0,0]
    a = [0.75, math.sqrt(1 - 0.75**2), 0.0]
    b = [1.0, 0.0, 0.0]

    mock = _mock_embed([a, b])
    with patch.object(svc.client.models, "embed_content", mock):
        result = svc.filter_suggestions(
            candidate_names=["borderline"],
            candidate_descriptions=["exactly at threshold"],
            existing_names=["existing"],
        )
    assert result == [{"name": "borderline", "description": "exactly at threshold"}]


def test_filter_returns_empty_when_no_candidates():
    import name_suggestion_service as svc
    result = svc.filter_suggestions(
        candidate_names=[],
        candidate_descriptions=[],
        existing_names=["confusion"],
    )
    assert result == []
