"""Unit tests for assist_service.nearest_neighbors."""
import numpy as np

import assist_service
from models import (
    LabelDefinition,
    LabelApplication,
    MessageCache,
    MessageEmbedding,
)


def _emb(values):
    """Encode a list of floats as the bytes shape MessageEmbedding stores."""
    return np.array(values, dtype=np.float32).tobytes()


def _seed_label(session, name="L"):
    label = LabelDefinition(name=name, mode="single")
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


def _seed_message(session, chatlog_id, message_index, text, vec):
    from concept_service import EMBED_MODEL
    session.add(MessageCache(
        chatlog_id=chatlog_id,
        message_index=message_index,
        message_text=text,
    ))
    session.add(MessageEmbedding(
        chatlog_id=chatlog_id,
        message_index=message_index,
        embedding=_emb(vec),
        model_version=EMBED_MODEL,
    ))
    session.commit()


def _seed_decision(session, label_id, chatlog_id, message_index, value):
    session.add(LabelApplication(
        label_id=label_id,
        chatlog_id=chatlog_id,
        message_index=message_index,
        applied_by="human",
        value=value,
    ))
    session.commit()


def test_nearest_neighbors_returns_top_k_by_cosine(session):
    label = _seed_label(session)
    # Focused message: vector pointing in [1, 0]
    _seed_message(session, 100, 0, "i'm stuck on q3", [1.0, 0.0])
    # Three already-labeled messages, by descending similarity to focused
    _seed_message(session, 200, 0, "i'm stuck on q4",  [0.99, 0.14])
    _seed_message(session, 201, 0, "how do i solve",   [0.80, 0.60])
    _seed_message(session, 202, 0, "why does numpy",   [0.0,  1.0])
    _seed_decision(session, label.id, 200, 0, "yes")
    _seed_decision(session, label.id, 201, 0, "yes")
    _seed_decision(session, label.id, 202, 0, "no")

    out = assist_service.nearest_neighbors(
        session, label_id=label.id, chatlog_id=100, message_index=0, k=2
    )
    assert len(out) == 2
    assert out[0]["chatlog_id"] == 200
    assert out[0]["value"] == "yes"
    assert out[0]["message_text"] == "i'm stuck on q4"
    assert 0.99 < out[0]["similarity"] <= 1.0
    assert out[1]["chatlog_id"] == 201


def test_nearest_neighbors_returns_empty_when_no_labeled(session):
    label = _seed_label(session)
    _seed_message(session, 100, 0, "x", [1.0, 0.0])
    out = assist_service.nearest_neighbors(
        session, label_id=label.id, chatlog_id=100, message_index=0, k=3
    )
    assert out == []


def test_nearest_neighbors_returns_empty_when_no_focused_embedding(session):
    label = _seed_label(session)
    # Labeled message has an embedding; focused does not.
    _seed_message(session, 200, 0, "labeled", [1.0, 0.0])
    _seed_decision(session, label.id, 200, 0, "yes")
    # Focused message has only a MessageCache, no MessageEmbedding.
    session.add(MessageCache(chatlog_id=100, message_index=0, message_text="focused"))
    session.commit()

    out = assist_service.nearest_neighbors(
        session, label_id=label.id, chatlog_id=100, message_index=0, k=3
    )
    assert out == []


def test_nearest_neighbors_excludes_focused_message_itself(session):
    """If the focused message is also a labeled message (e.g. on undo),
    exclude it from its own neighbor pool — it would otherwise rank itself
    at similarity=1.0."""
    label = _seed_label(session)
    _seed_message(session, 100, 0, "i'm stuck on q3", [1.0, 0.0])
    _seed_message(session, 200, 0, "different",       [0.5, 0.5])
    _seed_decision(session, label.id, 100, 0, "yes")  # focused labels itself
    _seed_decision(session, label.id, 200, 0, "no")

    out = assist_service.nearest_neighbors(
        session, label_id=label.id, chatlog_id=100, message_index=0, k=3
    )
    assert all(
        not (n["chatlog_id"] == 100 and n["message_index"] == 0)
        for n in out
    )
    assert len(out) == 1
    assert out[0]["chatlog_id"] == 200


def test_nearest_neighbors_excludes_skips(session):
    label = _seed_label(session)
    _seed_message(session, 100, 0, "focused", [1.0, 0.0])
    _seed_message(session, 200, 0, "skipped", [0.95, 0.31])
    _seed_message(session, 201, 0, "yes",     [0.30, 0.95])
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=200, message_index=0,
        applied_by="human", value="skip",
    ))
    _seed_decision(session, label.id, 201, 0, "yes")
    session.commit()

    out = assist_service.nearest_neighbors(
        session, label_id=label.id, chatlog_id=100, message_index=0, k=3
    )
    # The skipped message would have been the top similarity, but must be excluded.
    assert len(out) == 1
    assert out[0]["chatlog_id"] == 201


def test_build_cache_filters_by_current_model_version(session):
    """When MessageEmbedding contains rows from both the old (bare-text) and new
    (pair-format) model_versions, _build_cache must load ONLY the new ones.
    Otherwise the assist matrix mixes vectors of incompatible semantics."""
    from concept_service import EMBED_MODEL
    from assist_service import _build_cache

    # Pre-seed two rows: one OLD-key, one NEW-key, both at the same (chatlog_id, message_index).
    session.add(MessageEmbedding(
        chatlog_id=42,
        message_index=0,
        embedding=_emb([1.0, 0.0]),
        model_version="gemini-embedding-001",  # OLD
    ))
    session.add(MessageEmbedding(
        chatlog_id=42,
        message_index=0,
        embedding=_emb([0.0, 1.0]),
        model_version=EMBED_MODEL,  # NEW
    ))
    # Add a second NEW-key row at a different key so the matrix has > 1 vector.
    session.add(MessageEmbedding(
        chatlog_id=99,
        message_index=0,
        embedding=_emb([1.0, 1.0]),
        model_version=EMBED_MODEL,
    ))
    session.commit()

    cache = _build_cache(session, fingerprint=(0, 0, 0))

    # Only the NEW-key vectors should be loaded.
    assert cache["matrix"] is not None
    assert cache["matrix"].shape[0] == 2  # two NEW rows, not three
    keys = set(cache["keys_idx"].keys())
    assert keys == {(42, 0), (99, 0)}

    # Verify (42, 0)'s vector is the NEW one ([0, 1] normalized), not the OLD one ([1, 0]).
    idx = cache["keys_idx"][(42, 0)]
    vec = cache["matrix"][idx]
    # Normalized [0, 1] is just [0, 1]. Normalized [1, 0] is [1, 0]. So vec[1] should be ~1.0.
    assert vec[1] > 0.99
    assert vec[0] < 0.01
