"""Tests for concept_service — embedding and RAG-style discovery orchestrator."""
import numpy as np
from unittest.mock import patch, MagicMock
from sqlmodel import select

from models import (
    MessageEmbedding, ConceptCandidate, LabelDefinition,
    DiscoveryRun, MessageCache, LabelApplication,
)


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


def test_discover_broad_label_creates_run_and_candidates(session):
    for i in range(10):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"msg{i}"))
    session.commit()

    fake_retrieved = [
        {"chatlog_id": 1, "message_index": i, "message_text": f"msg{i}"}
        for i in range(5)
    ]
    fake_drafts = [{
        "kind": "broad_label",
        "name": "curious",
        "description": "students expressing curiosity",
        "evidence_message_ids": [{"chatlog_id": 1, "message_index": 0}],
    }]

    with patch("concept_service.retrieve_residual", return_value=fake_retrieved), \
         patch("concept_service.generate_broad_labels", return_value=fake_drafts), \
         patch("concept_service._read_recalibration_due", return_value=False):
        from concept_service import discover
        run = discover(session, query_kind="broad_label", trigger="manual")

    assert run.id is not None
    assert run.completed_at is not None
    assert run.error is None
    assert run.n_candidates == 1
    assert run.pool_size_at_trigger == 5

    candidates = session.exec(
        select(ConceptCandidate).where(ConceptCandidate.discovery_run_id == run.id)
    ).all()
    assert len(candidates) == 1
    assert candidates[0].kind == "broad_label"
    assert candidates[0].name == "curious"


def test_discover_records_error_on_failure(session):
    with patch(
        "concept_service.retrieve_residual",
        side_effect=RuntimeError("boom"),
    ), patch("concept_service._read_recalibration_due", return_value=False):
        from concept_service import discover
        run = discover(session, query_kind="broad_label", trigger="manual")
    assert run.error == "boom"
    assert run.completed_at is not None
    assert run.n_candidates == 0


def test_discover_co_occurrence_path(session):
    label_a = LabelDefinition(name="A")
    label_b = LabelDefinition(name="B")
    session.add_all([label_a, label_b])
    session.commit()
    session.refresh(label_a); session.refresh(label_b)

    for i in range(2):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"m{i}"))
        session.add(LabelApplication(
            chatlog_id=1, message_index=i, label_id=label_a.id, applied_by="human",
        ))
        session.add(LabelApplication(
            chatlog_id=1, message_index=i, label_id=label_b.id, applied_by="human",
        ))
    session.commit()

    fake_drafts = [{
        "kind": "co_occurrence", "name": "combo",
        "description": "A+B together",
        "co_occurrence_label_ids": [label_a.id, label_b.id],
        "co_occurrence_count": 2,
        "suggested_resolution": "independent",
        "evidence_message_ids": [],
    }]

    with patch("concept_service.generate_co_occurrence_concepts", return_value=fake_drafts), \
         patch("concept_service._read_recalibration_due", return_value=False):
        from concept_service import discover
        run = discover(session, query_kind="co_occurrence", trigger="manual", min_count=1)

    assert run.query_kind == "co_occurrence"
    assert run.n_candidates == 1
    cc = session.exec(
        select(ConceptCandidate).where(ConceptCandidate.discovery_run_id == run.id)
    ).one()
    assert cc.kind == "co_occurrence"
    assert cc.co_occurrence_count == 2


def test_accept_broad_label_creates_label_and_ai_applies(session):
    for i in range(3):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"m{i}"))
    run = DiscoveryRun(
        query_kind="broad_label", trigger="manual", pool_size_at_trigger=3,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    cc = ConceptCandidate(
        name="metacognition",
        description="reflection on own learning",
        example_messages="[]",
        source_run_id=str(run.id),
        kind="broad_label",
        discovery_run_id=run.id,
        evidence_message_ids='[{"chatlog_id":1,"message_index":0},{"chatlog_id":1,"message_index":2}]',
    )
    session.add(cc)
    session.commit()
    session.refresh(cc)

    from concept_service import accept_broad_label
    result = accept_broad_label(cc.id, session)

    assert result.created_label_id is not None
    assert result.applied_count == 2

    session.refresh(cc)
    assert cc.decision == "accept"
    assert cc.decided_at is not None
    assert cc.created_label_id == result.created_label_id

    apps = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == result.created_label_id
        )
    ).all()
    assert len(apps) == 2
    assert all(a.applied_by == "ai" for a in apps)
    assert all(a.confidence == 0.6 for a in apps)


def test_accept_broad_label_rejects_co_occurrence_kind(session):
    import pytest as _pytest
    run = DiscoveryRun(
        query_kind="co_occurrence", trigger="manual", pool_size_at_trigger=0,
    )
    session.add(run); session.commit(); session.refresh(run)
    cc = ConceptCandidate(
        name="x+y", description="", example_messages="[]",
        source_run_id=str(run.id),
        kind="co_occurrence", discovery_run_id=run.id,
    )
    session.add(cc); session.commit(); session.refresh(cc)
    from concept_service import accept_broad_label
    with _pytest.raises(ValueError, match="kind"):
        accept_broad_label(cc.id, session)


def test_is_discovery_ripe_returns_signal_dict(session):
    from concept_service import is_discovery_ripe
    sig = is_discovery_ripe(session, min_pool=5)
    assert sig["ripe"] is False
    assert "pool_size" in sig
    assert "drift_value" in sig
    assert "reasons" in sig
    assert "pool_below_threshold" in sig["reasons"]


def test_is_discovery_ripe_when_pool_large_and_recal_due(session, monkeypatch):
    for i in range(10):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"m{i}"))
    session.commit()
    monkeypatch.setattr(
        "concept_service._read_recalibration_due", lambda db: True
    )
    from concept_service import is_discovery_ripe
    sig = is_discovery_ripe(session, min_pool=5)
    assert sig["ripe"] is True
    assert sig["drift_value"] == 1.0
    assert sig["pool_size"] >= 5
    assert sig["reasons"] == ["ok"]
