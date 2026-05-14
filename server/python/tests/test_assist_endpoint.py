"""Integration tests for GET /api/single-labels/{id}/assist."""
import numpy as np

from models import LabelApplication, LabelDefinition, MessageCache, MessageEmbedding


def _emb(values):
    return np.array(values, dtype=np.float32).tobytes()


def _seed_label(session, name="L"):
    label = LabelDefinition(name=name, mode="single", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


def test_assist_endpoint_returns_nearest_labeled_neighbors(client, session):
    label = _seed_label(session)
    # Focused message + two labeled candidates with controlled embeddings.
    # Cosine ranks by closeness to focused vector.
    session.add(MessageCache(chatlog_id=200, message_index=0, message_text="focus"))
    session.add(MessageEmbedding(chatlog_id=200, message_index=0, embedding=_emb([1.0, 0.0])))
    session.add(MessageCache(chatlog_id=100, message_index=0, message_text="i'm stuck on q3"))
    session.add(MessageEmbedding(chatlog_id=100, message_index=0, embedding=_emb([0.95, 0.31])))
    session.add(MessageCache(chatlog_id=101, message_index=0, message_text="what is variance"))
    session.add(MessageEmbedding(chatlog_id=101, message_index=0, embedding=_emb([0.31, 0.95])))
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=100, message_index=0,
        applied_by="human", confidence=1.0, value="yes",
    ))
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=101, message_index=0,
        applied_by="human", confidence=1.0, value="no",
    ))
    session.commit()

    r = client.get(
        f"/api/single-labels/{label.id}/assist",
        params={"chatlog_id": 200, "message_index": 0},
    )
    assert r.status_code == 200
    body = r.json()
    assert "neighbors" in body
    assert len(body["neighbors"]) == 2
    # The "yes" neighbor (closer cosine) ranks first
    assert body["neighbors"][0]["chatlog_id"] == 100
    assert body["neighbors"][0]["value"] == "yes"
    assert body["neighbors"][0]["message_text"] == "i'm stuck on q3"
    assert body["neighbors"][0]["similarity"] > body["neighbors"][1]["similarity"]


def test_assist_endpoint_returns_empty_when_focus_has_no_embedding(client, session):
    label = _seed_label(session)
    r = client.get(
        f"/api/single-labels/{label.id}/assist",
        params={"chatlog_id": 999, "message_index": 0},
    )
    assert r.status_code == 200
    assert r.json() == {"neighbors": []}


def test_assist_endpoint_returns_empty_when_no_labeled_neighbors(client, session):
    label = _seed_label(session)
    session.add(MessageCache(chatlog_id=200, message_index=0, message_text="focus"))
    session.add(MessageEmbedding(chatlog_id=200, message_index=0, embedding=_emb([1.0, 0.0])))
    session.commit()
    r = client.get(
        f"/api/single-labels/{label.id}/assist",
        params={"chatlog_id": 200, "message_index": 0},
    )
    assert r.status_code == 200
    assert r.json() == {"neighbors": []}


def test_assist_endpoint_excludes_focused_message_from_its_own_neighbors(client, session):
    """A labeled message that's currently being re-focused (e.g. after undo)
    must not appear in its own neighbor list."""
    label = _seed_label(session)
    session.add(MessageCache(chatlog_id=200, message_index=0, message_text="focus"))
    session.add(MessageEmbedding(chatlog_id=200, message_index=0, embedding=_emb([1.0, 0.0])))
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=200, message_index=0,
        applied_by="human", confidence=1.0, value="yes",
    ))
    session.commit()
    r = client.get(
        f"/api/single-labels/{label.id}/assist",
        params={"chatlog_id": 200, "message_index": 0},
    )
    assert r.status_code == 200
    assert r.json() == {"neighbors": []}


def test_assist_endpoint_404_for_unknown_label(client, session):
    r = client.get(
        "/api/single-labels/99999/assist",
        params={"chatlog_id": 1, "message_index": 0},
    )
    assert r.status_code == 404


def test_assist_endpoint_400_for_multi_mode_label(client, session):
    """The route is single-label only — multi-mode labels return 400."""
    label = LabelDefinition(name="M", mode="multi", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    r = client.get(
        f"/api/single-labels/{label.id}/assist",
        params={"chatlog_id": 1, "message_index": 0},
    )
    assert r.status_code == 400
