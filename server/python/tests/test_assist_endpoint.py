"""Integration tests for GET /api/single-labels/{id}/assist."""
import json

import numpy as np
from sqlmodel import select

from models import LabelDefinition, LabelApplication, LabelPrediction, MessageCache, MessageEmbedding


def _emb(values):
    return np.array(values, dtype=np.float32).tobytes()


def _seed_label(session, name="L"):
    label = LabelDefinition(name=name, mode="single", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


def test_assist_endpoint_returns_cached_neighbors(client, session):
    label = _seed_label(session)
    # Seed a single LabelPrediction row for the focused (200, 0) message.
    neighbors = [
        {"chatlog_id": 100, "message_index": 0, "value": "yes",
         "similarity": 0.91, "message_text": "i'm stuck on q3"},
        {"chatlog_id": 101, "message_index": 0, "value": "no",
         "similarity": 0.62, "message_text": "what is variance"},
    ]
    session.add(LabelPrediction(
        label_id=label.id,
        chatlog_id=200,
        message_index=0,
        nearest_neighbors=json.dumps(neighbors),
        model_version=10,
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
    assert body["neighbors"][0]["chatlog_id"] == 100
    assert body["neighbors"][0]["value"] == "yes"
    assert body["neighbors"][0]["similarity"] == 0.91
    assert body["neighbors"][0]["message_text"] == "i'm stuck on q3"


def test_assist_endpoint_returns_empty_when_no_cache(client, session):
    label = _seed_label(session)
    r = client.get(
        f"/api/single-labels/{label.id}/assist",
        params={"chatlog_id": 999, "message_index": 0},
    )
    assert r.status_code == 200
    body = r.json()
    assert body == {"neighbors": []}


def test_assist_endpoint_404_for_unknown_label(client, session):
    r = client.get(
        "/api/single-labels/99999/assist",
        params={"chatlog_id": 1, "message_index": 0},
    )
    assert r.status_code == 404


def test_assist_endpoint_404_for_multi_mode_label(client, session):
    """The route is single-label only — multi-mode labels return 404."""
    label = LabelDefinition(name="M", mode="multi", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    r = client.get(
        f"/api/single-labels/{label.id}/assist",
        params={"chatlog_id": 1, "message_index": 0},
    )
    assert r.status_code == 404
