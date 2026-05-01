"""Tests for MessageEmbedding, ConceptCandidate, and DiscoveryRun models."""
import json
import numpy as np
from sqlmodel import select

from models import MessageEmbedding, ConceptCandidate, DiscoveryRun, LabelDefinition


def test_message_embedding_roundtrip(session):
    vec = np.random.rand(3072).astype(np.float32)
    row = MessageEmbedding(
        chatlog_id=1,
        message_index=0,
        embedding=vec.tobytes(),
        model_version="gemini-embedding-001",
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    loaded = session.exec(
        select(MessageEmbedding).where(
            MessageEmbedding.chatlog_id == 1,
            MessageEmbedding.message_index == 0,
        )
    ).one()
    restored = np.frombuffer(loaded.embedding, dtype=np.float32)
    assert restored.shape == (3072,)
    assert np.allclose(vec, restored)


def test_concept_candidate_roundtrip(session):
    row = ConceptCandidate(
        name="Debugging Strategy",
        description="Student systematically tests hypotheses",
        example_messages=json.dumps([
            {"chatlog_id": 1, "message_index": 2, "excerpt": "Let me try printing..."}
        ]),
        status="pending",
        source_run_id="run-abc123",
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    loaded = session.exec(
        select(ConceptCandidate).where(ConceptCandidate.id == row.id)
    ).one()
    assert loaded.name == "Debugging Strategy"
    assert loaded.status == "pending"
    examples = json.loads(loaded.example_messages)
    assert len(examples) == 1
    assert examples[0]["excerpt"] == "Let me try printing..."


def test_concept_candidate_has_new_fields(session):
    run = DiscoveryRun(
        query_kind="broad_label", trigger="manual", pool_size_at_trigger=10
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    label = LabelDefinition(name="example")
    session.add(label)
    session.commit()
    session.refresh(label)

    cc = ConceptCandidate(
        name="curiosity",
        description="student expressing curiosity",
        example_messages="[]",
        source_run_id="legacy",
        kind="broad_label",
        discovery_run_id=run.id,
        evidence_message_ids='[{"chatlog_id": 1, "message_index": 0}]',
        created_label_id=label.id,
        decision="accept",
    )
    session.add(cc)
    session.commit()
    session.refresh(cc)
    assert cc.kind == "broad_label"
    assert cc.discovery_run_id == run.id
    assert cc.created_label_id == label.id
    assert cc.decision == "accept"
    assert cc.co_occurrence_label_ids is None
    assert cc.co_occurrence_count is None


def test_concept_candidate_legacy_fields_still_work(session):
    cc = ConceptCandidate(
        name="legacy",
        description="legacy candidate without new fields",
        example_messages="[]",
        source_run_id="oldrun123",
    )
    session.add(cc)
    session.commit()
    session.refresh(cc)
    assert cc.kind == "broad_label"  # default
    assert cc.discovery_run_id is None
    assert cc.status == "pending"  # legacy column intact


def test_discovery_run_can_be_created(session):
    run = DiscoveryRun(
        query_kind="broad_label",
        trigger="manual",
        pool_size_at_trigger=42,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    assert run.id is not None
    assert run.started_at is not None
    assert run.completed_at is None
    assert run.n_candidates == 0
    assert run.error is None
    assert run.drift_value_at_trigger is None
