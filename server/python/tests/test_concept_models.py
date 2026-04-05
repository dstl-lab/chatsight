"""Tests for MessageEmbedding and ConceptCandidate models."""
import json
import numpy as np
from sqlmodel import select

from models import MessageEmbedding, ConceptCandidate


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
