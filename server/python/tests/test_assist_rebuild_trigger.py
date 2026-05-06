"""End-to-end test: /next triggers cache rebuild after enough new labels."""
import json

from sqlmodel import select

from models import LabelDefinition, LabelPrediction, MessageCache, MessageEmbedding, LabelApplication
import numpy as np


def _emb(values):
    return np.array(values, dtype=np.float32).tobytes()


def _seed_corpus(session, n=10):
    """n cached messages with simple 2D embeddings, all in the same conversation."""
    for i in range(n):
        # Spread the embeddings across [1,0]→[0,1] so cosine similarity ranks
        # neighbors by closeness to whatever message is queried.
        angle = (i / max(n - 1, 1)) * (np.pi / 2)
        vec = [float(np.cos(angle)), float(np.sin(angle))]
        session.add(MessageCache(
            chatlog_id=300, message_index=i, message_text=f"msg {i}",
        ))
        session.add(MessageEmbedding(
            chatlog_id=300, message_index=i, embedding=_emb(vec),
        ))
    session.commit()


def _make_active_label(client):
    label = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{label['id']}/activate")
    return label


def _decide(client, label_id, chatlog_id, message_index, value):
    return client.post(
        f"/api/single-labels/{label_id}/decide",
        json={"chatlog_id": chatlog_id, "message_index": message_index, "value": value},
    )


def test_rebuild_fires_after_five_new_labels(client, session):
    _seed_corpus(session, n=10)
    label = _make_active_label(client)

    # No predictions yet — never built.
    rows = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label["id"])
    ).all()
    assert rows == []

    # Make 5 yes/no decisions. The 5th /decide → /next call should trigger a rebuild.
    for i in range(5):
        _decide(client, label["id"], 300, i, "yes" if i % 2 == 0 else "no")

    # Trigger /next explicitly — even if /decide already advances, /next is the rebuild gate.
    client.get(f"/api/single-labels/{label['id']}/next")

    rows = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label["id"])
    ).all()
    # 10 messages, 5 labeled → 5 unlabeled → 5 rows.
    assert len(rows) == 5
    # Every row carries the current model_version (= human label count = 5).
    assert all(r.model_version == 5 for r in rows)
    # Each row's neighbor JSON parses and is non-empty (since labeled set is non-empty).
    for r in rows:
        decoded = json.loads(r.nearest_neighbors)
        assert len(decoded) >= 1
        assert "value" in decoded[0]
        assert "similarity" in decoded[0]


def test_no_rebuild_below_threshold(client, session):
    _seed_corpus(session, n=10)
    label = _make_active_label(client)

    # Only 2 decisions — below the 5-label rebuild threshold.
    _decide(client, label["id"], 300, 0, "yes")
    _decide(client, label["id"], 300, 1, "no")
    client.get(f"/api/single-labels/{label['id']}/next")

    rows = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label["id"])
    ).all()
    assert rows == []


def test_rebuild_wipes_old_rows(client, session):
    _seed_corpus(session, n=10)
    label = _make_active_label(client)

    for i in range(5):
        _decide(client, label["id"], 300, i, "yes")
    client.get(f"/api/single-labels/{label['id']}/next")

    first_count = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label["id"])
    ).all()
    assert len(first_count) == 5

    # 5 more decisions → label count = 10. /next should wipe and rebuild with 0 unlabeled left.
    # Wait — after 10 decisions, all messages are labeled, pending = []. So 0 prediction rows.
    for i in range(5, 10):
        _decide(client, label["id"], 300, i, "no")
    client.get(f"/api/single-labels/{label['id']}/next")

    second = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label["id"])
    ).all()
    assert second == []  # nothing to predict on; cache wiped + nothing rebuilt
