"""Tests for concept induction API endpoints."""
import json
from models import ConceptCandidate, LabelDefinition
from sqlmodel import select


def test_get_candidates_empty(client):
    resp = client.get("/api/concepts/candidates")
    assert resp.status_code == 200
    assert resp.json() == []


def test_resolve_candidate_accept(client, session):
    candidate = ConceptCandidate(
        name="Debugging Strategy",
        description="Student tests hypotheses",
        example_messages='[{"excerpt": "Let me try..."}]',
        status="pending",
        source_run_id="run-test",
    )
    session.add(candidate)
    session.commit()
    session.refresh(candidate)
    cid = candidate.id

    resp = client.put(f"/api/concepts/candidates/{cid}", json={"action": "accept"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Debugging Strategy"
    assert "id" in data

    # Verify candidate status updated
    session.expire_all()
    updated = session.get(ConceptCandidate, cid)
    assert updated.status == "accepted"

    # Verify LabelDefinition was created
    label = session.exec(
        select(LabelDefinition).where(LabelDefinition.name == "Debugging Strategy")
    ).first()
    assert label is not None
    assert label.description == "Student tests hypotheses"


def test_resolve_candidate_accept_with_rename(client, session):
    candidate = ConceptCandidate(
        name="Off-Topic Chat",
        description="Non-academic conversation",
        example_messages="[]",
        status="pending",
        source_run_id="run-test",
    )
    session.add(candidate)
    session.commit()
    session.refresh(candidate)
    cid = candidate.id

    resp = client.put(
        f"/api/concepts/candidates/{cid}",
        json={"action": "accept", "name": "Social Chat"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Social Chat"

    # Original name should not exist as a label
    label = session.exec(
        select(LabelDefinition).where(LabelDefinition.name == "Off-Topic Chat")
    ).first()
    assert label is None


def test_resolve_candidate_reject(client, session):
    candidate = ConceptCandidate(
        name="Off-Topic Chat",
        description="Non-academic conversation",
        example_messages="[]",
        status="pending",
        source_run_id="run-test",
    )
    session.add(candidate)
    session.commit()
    session.refresh(candidate)
    cid = candidate.id

    resp = client.put(f"/api/concepts/candidates/{cid}", json={"action": "reject"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    session.expire_all()
    updated = session.get(ConceptCandidate, cid)
    assert updated.status == "rejected"


def test_resolve_candidate_not_found(client):
    resp = client.put("/api/concepts/candidates/9999", json={"action": "accept"})
    assert resp.status_code == 404


def test_get_candidates_excludes_resolved(client, session):
    session.add(ConceptCandidate(
        name="Pending One", description="d", example_messages="[]",
        status="pending", source_run_id="run-1",
    ))
    session.add(ConceptCandidate(
        name="Accepted One", description="d", example_messages="[]",
        status="accepted", source_run_id="run-1",
    ))
    session.add(ConceptCandidate(
        name="Rejected One", description="d", example_messages="[]",
        status="rejected", source_run_id="run-1",
    ))
    session.commit()

    resp = client.get("/api/concepts/candidates")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Pending One"


def test_embed_status(client):
    resp = client.get("/api/concepts/embed-status")
    assert resp.status_code == 200
    data = resp.json()
    assert "cached" in data
    assert "total_unlabeled" in data
    assert "running" in data
