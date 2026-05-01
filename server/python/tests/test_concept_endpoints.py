"""Tests for concept induction API endpoints."""
import json
from datetime import datetime
from models import (
    ConceptCandidate, LabelDefinition, LabelApplication, MessageCache,
    DiscoveryRun,
)
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


# ── New RAG-discovery endpoints ────────────────────────────────────


def test_post_discover_rejects_unknown_query_kind(client):
    resp = client.post("/api/concepts/discover", json={
        "query_kind": "made_up", "trigger": "manual",
    })
    assert resp.status_code == 422


def test_post_discover_rejects_unknown_trigger(client):
    resp = client.post("/api/concepts/discover", json={
        "query_kind": "broad_label", "trigger": "cosmic_ray",
    })
    assert resp.status_code == 422


def test_get_ripe_returns_signal(client):
    resp = client.get("/api/concepts/ripe")
    assert resp.status_code == 200
    body = resp.json()
    assert "ripe" in body
    assert "pool_size" in body
    assert "drift_value" in body
    assert "reasons" in body
    assert isinstance(body["reasons"], list)


def test_post_accept_creates_label_and_applies(client, session):
    for i in range(2):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"m{i}"))
    run = DiscoveryRun(
        query_kind="broad_label", trigger="manual", pool_size_at_trigger=2,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    cc = ConceptCandidate(
        name="curious", description="curious students",
        example_messages="[]", source_run_id=str(run.id),
        kind="broad_label", discovery_run_id=run.id,
        evidence_message_ids='[{"chatlog_id":1,"message_index":0}]',
    )
    session.add(cc)
    session.commit()
    session.refresh(cc)

    resp = client.post(f"/api/concepts/candidates/{cc.id}/accept", json={})
    assert resp.status_code == 200
    body = resp.json()
    assert body["candidate_id"] == cc.id
    assert body["created_label_id"] is not None
    assert body["applied_count"] == 1


def test_post_accept_404_for_unknown_candidate(client):
    resp = client.post("/api/concepts/candidates/99999/accept", json={})
    assert resp.status_code == 404


def test_post_dismiss_sets_decision(client, session):
    cc = ConceptCandidate(
        name="x", description="", example_messages="[]",
        source_run_id="r", kind="broad_label",
    )
    session.add(cc)
    session.commit()
    session.refresh(cc)

    resp = client.post(
        f"/api/concepts/candidates/{cc.id}/dismiss",
        json={"reason": "too narrow"},
    )
    assert resp.status_code == 200

    session.expire_all()
    refreshed = session.get(ConceptCandidate, cc.id)
    assert refreshed.decision == "dismiss"
    assert refreshed.decided_at is not None


def test_post_note_only_for_co_occurrence(client, session):
    cc_co = ConceptCandidate(
        name="A+B", description="", example_messages="[]",
        source_run_id="r", kind="co_occurrence",
        co_occurrence_label_ids="[1,2]", co_occurrence_count=5,
    )
    cc_broad = ConceptCandidate(
        name="x", description="", example_messages="[]",
        source_run_id="r", kind="broad_label",
    )
    session.add_all([cc_co, cc_broad])
    session.commit()
    session.refresh(cc_co); session.refresh(cc_broad)

    resp_ok = client.post(f"/api/concepts/candidates/{cc_co.id}/note", json={})
    assert resp_ok.status_code == 200

    resp_bad = client.post(f"/api/concepts/candidates/{cc_broad.id}/note", json={})
    assert resp_bad.status_code == 400


def test_post_make_label_creates_label(client, session):
    cc = ConceptCandidate(
        name="A+B", description="combo", example_messages="[]",
        source_run_id="r", kind="co_occurrence",
        co_occurrence_label_ids="[1,2]", co_occurrence_count=5,
    )
    session.add(cc)
    session.commit()
    session.refresh(cc)

    resp = client.post(f"/api/concepts/candidates/{cc.id}/make-label", json={})
    assert resp.status_code == 200
    body = resp.json()
    assert body["created_label_id"] is not None

    label = session.exec(
        select(LabelDefinition).where(LabelDefinition.id == body["created_label_id"])
    ).one()
    assert label.name == "A+B"
    # No auto-apply: no LabelApplications for this label.
    apps = session.exec(
        select(LabelApplication).where(LabelApplication.label_id == label.id)
    ).all()
    assert apps == []


def test_post_suggest_merge_archives_and_retags(client, session):
    label_a = LabelDefinition(name="A")
    label_b = LabelDefinition(name="B")
    session.add_all([label_a, label_b])
    session.commit()
    session.refresh(label_a); session.refresh(label_b)

    session.add(LabelApplication(
        chatlog_id=1, message_index=0, label_id=label_a.id, applied_by="human",
    ))
    session.commit()

    cc = ConceptCandidate(
        name="A+B", description="", example_messages="[]",
        source_run_id="r", kind="co_occurrence",
        co_occurrence_label_ids=f"[{label_a.id},{label_b.id}]",
        co_occurrence_count=1,
    )
    session.add(cc)
    session.commit()
    session.refresh(cc)

    resp = client.post(
        f"/api/concepts/candidates/{cc.id}/suggest-merge",
        json={"archive_label_id": label_a.id, "keep_label_id": label_b.id},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["archived_label_id"] == label_a.id
    assert body["kept_label_id"] == label_b.id
    assert body["retagged_count"] >= 1

    session.expire_all()
    # label_a deleted; label_b has the retagged application
    assert session.get(LabelDefinition, label_a.id) is None
    apps = session.exec(
        select(LabelApplication).where(LabelApplication.label_id == label_b.id)
    ).all()
    assert len(apps) == 1


def test_get_candidates_includes_new_fields(client, session):
    cc = ConceptCandidate(
        name="x", description="", example_messages="[]",
        source_run_id="r", kind="broad_label",
        evidence_message_ids='[{"chatlog_id":1,"message_index":0}]',
    )
    session.add(cc)
    session.commit()
    session.refresh(cc)

    resp = client.get("/api/concepts/candidates")
    assert resp.status_code == 200
    rows = resp.json()
    target = next(r for r in rows if r["id"] == cc.id)
    assert target["kind"] == "broad_label"
    assert target["evidence_message_ids"] == [
        {"chatlog_id": 1, "message_index": 0}
    ]
    assert target.get("co_occurrence_label_ids") in (None, [])
    assert "decision" in target


def test_get_candidates_filters_by_kind_and_run_id(client, session):
    run = DiscoveryRun(
        query_kind="broad_label", trigger="manual", pool_size_at_trigger=0,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    cc1 = ConceptCandidate(
        name="a", description="", example_messages="[]",
        source_run_id=str(run.id), kind="broad_label", discovery_run_id=run.id,
    )
    cc2 = ConceptCandidate(
        name="b", description="", example_messages="[]",
        source_run_id=str(run.id), kind="co_occurrence", discovery_run_id=run.id,
    )
    session.add_all([cc1, cc2])
    session.commit()
    session.refresh(cc1); session.refresh(cc2)

    resp = client.get(
        f"/api/concepts/candidates?run_id={run.id}&kind=broad_label"
    )
    assert resp.status_code == 200
    ids = {r["id"] for r in resp.json()}
    assert cc1.id in ids and cc2.id not in ids


def test_get_runs_returns_recent(client, session):
    for k in ("broad_label", "co_occurrence"):
        session.add(DiscoveryRun(
            query_kind=k, trigger="manual", pool_size_at_trigger=0,
        ))
    session.commit()

    resp = client.get("/api/concepts/runs?limit=5")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) >= 2
    assert all("query_kind" in r and "trigger" in r for r in rows)
