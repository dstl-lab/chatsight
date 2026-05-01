"""Tests for the concept_retrieval module."""
from datetime import datetime
import numpy as np
import pytest

from concept_retrieval import (
    select_diverse, thinly_labeled_pool, retrieve_residual,
    retrieve_co_occurrence,
)
from models import MessageCache, LabelDefinition, LabelApplication


def test_select_diverse_returns_k_indices():
    rng = np.random.default_rng(0)
    vectors = rng.normal(size=(20, 8)).astype(np.float32)
    chosen = select_diverse(vectors, k=5)
    assert len(chosen) == 5
    assert len(set(chosen)) == 5  # no duplicates
    assert all(0 <= i < 20 for i in chosen)


def test_select_diverse_picks_far_apart_points():
    # Three tight clusters of 5 points each; k=3 should pick one from each.
    centers = np.array([[10.0, 0], [-10.0, 0], [0, 10.0]], dtype=np.float32)
    chunks = [
        centers[i] + np.random.RandomState(i).normal(scale=0.01, size=(5, 2))
        for i in range(3)
    ]
    points = np.vstack(chunks).astype(np.float32)
    chosen = select_diverse(points, k=3)
    chosen_pts = points[chosen]
    # All three picked points should be far from each other (>5 apart).
    for i in range(3):
        for j in range(i + 1, 3):
            d = np.linalg.norm(chosen_pts[i] - chosen_pts[j])
            assert d > 5, f"chosen points {i} and {j} are too close: {d}"


def test_select_diverse_handles_k_geq_n():
    vectors = np.eye(3, dtype=np.float32)
    chosen = select_diverse(vectors, k=5)
    # Cannot select more than n; returns all unique indices.
    assert sorted(chosen) == [0, 1, 2]


def test_thinly_labeled_pool_excludes_human_labeled(session):
    # Three messages: human-labeled, AI-only-labeled, unlabeled.
    for i, text in enumerate(["a", "b", "c"]):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=text))
    label = LabelDefinition(name="L1")
    session.add(label)
    session.commit()
    session.refresh(label)

    # Message 0: human-applied (excluded from pool).
    session.add(LabelApplication(
        chatlog_id=1, message_index=0, label_id=label.id,
        applied_by="human", confidence=None,
    ))
    # Message 1: AI-applied only (still in pool).
    session.add(LabelApplication(
        chatlog_id=1, message_index=1, label_id=label.id,
        applied_by="ai", confidence=0.5,
    ))
    session.commit()

    pool = thinly_labeled_pool(session)
    keys = {(m["chatlog_id"], m["message_index"]) for m in pool}
    assert (1, 0) not in keys      # human-labeled — excluded
    assert (1, 1) in keys          # AI-only — included
    assert (1, 2) in keys          # unlabeled — included


def test_retrieve_residual_filters_high_similarity_messages(session, monkeypatch):
    """Messages whose embedding is close to an existing label are filtered out."""
    for i in range(5):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"m{i}"))
    label = LabelDefinition(name="LX", description="thing")
    session.add(label)
    session.commit()

    # Messages 0,1 close to label; 2,3,4 far. With threshold 0.55, residual = {2,3,4}.
    msg_vecs = np.array([
        [1, 0, 0, 0],
        [0.9, 0.1, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
    ], dtype=np.float32)
    label_vecs = np.array([[1, 0, 0, 0]], dtype=np.float32)

    monkeypatch.setattr(
        "concept_retrieval._embed_messages",
        lambda messages, db: msg_vecs[: len(messages)],
    )
    monkeypatch.setattr(
        "concept_retrieval._embed_label_definitions",
        lambda labels, db: label_vecs,
    )

    residual = retrieve_residual(session, threshold=0.55, target_size=10)
    keys = sorted((m["chatlog_id"], m["message_index"]) for m in residual)
    assert keys == [(1, 2), (1, 3), (1, 4)]


def test_retrieve_residual_caps_at_target_size(session, monkeypatch):
    for i in range(20):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"m{i}"))
    session.commit()

    msg_vecs = np.eye(20, dtype=np.float32)
    monkeypatch.setattr(
        "concept_retrieval._embed_messages",
        lambda m, db: msg_vecs[: len(m)],
    )
    # No labels → no label_vecs → all messages pass residual filter.
    monkeypatch.setattr(
        "concept_retrieval._embed_label_definitions",
        lambda l, db: np.zeros((0, 20), dtype=np.float32),
    )

    residual = retrieve_residual(session, threshold=0.55, target_size=5)
    assert len(residual) == 5


def test_retrieve_co_occurrence_finds_frequent_pairs(session):
    label_a = LabelDefinition(name="A")
    label_b = LabelDefinition(name="B")
    label_c = LabelDefinition(name="C")
    session.add_all([label_a, label_b, label_c])
    session.commit()
    session.refresh(label_a); session.refresh(label_b); session.refresh(label_c)

    for i in range(3):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"m{i}"))
        session.add(LabelApplication(
            chatlog_id=1, message_index=i, label_id=label_a.id, applied_by="human",
        ))
        session.add(LabelApplication(
            chatlog_id=1, message_index=i, label_id=label_b.id, applied_by="human",
        ))
    # A lone C label, no pairing partner above threshold.
    session.add(MessageCache(chatlog_id=1, message_index=99, message_text="lonely"))
    session.add(LabelApplication(
        chatlog_id=1, message_index=99, label_id=label_c.id, applied_by="human",
    ))
    session.commit()

    pairs = retrieve_co_occurrence(session, min_count=2)
    expected_pair = tuple(sorted([label_a.id, label_b.id]))
    matching = [p for p in pairs
                if tuple(sorted([p["label_a_id"], p["label_b_id"]])) == expected_pair]
    assert len(matching) == 1
    assert matching[0]["count"] == 3
    assert len(matching[0]["example_message_ids"]) >= 1


def test_retrieve_co_occurrence_ignores_ai_labels(session):
    label_a = LabelDefinition(name="A")
    label_b = LabelDefinition(name="B")
    session.add_all([label_a, label_b])
    session.commit()
    session.refresh(label_a); session.refresh(label_b)
    session.add(LabelApplication(
        chatlog_id=1, message_index=0, label_id=label_a.id,
        applied_by="ai", confidence=0.7,
    ))
    session.add(LabelApplication(
        chatlog_id=1, message_index=0, label_id=label_b.id, applied_by="human",
    ))
    session.commit()
    pairs = retrieve_co_occurrence(session, min_count=1)
    # Only one human label on this message; no human-human pair.
    assert pairs == []
