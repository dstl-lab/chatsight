"""Tests for assignment_service + /api/assignments endpoints."""
import assignment_service
from models import AssignmentMapping, MessageCache


def _seed_messages(session):
    session.add(MessageCache(chatlog_id=400, message_index=0, message_text="m", notebook="lab3.ipynb"))
    session.add(MessageCache(chatlog_id=401, message_index=0, message_text="m", notebook="lab03.ipynb"))
    session.add(MessageCache(chatlog_id=402, message_index=0, message_text="m", notebook="lab4.ipynb"))
    session.add(MessageCache(chatlog_id=403, message_index=0, message_text="m", notebook="project1.ipynb"))
    session.add(MessageCache(chatlog_id=404, message_index=0, message_text="m", notebook=None))
    session.commit()


def test_match_all_with_no_mappings_clears_assignments(session):
    _seed_messages(session)
    rows = session.exec(MessageCache.__table__.select()).all()
    # Pre-tag a row to simulate stale state
    one = session.get(MessageCache, rows[0].id)
    one.assignment_id = 99
    session.add(one)
    session.commit()
    cleared = assignment_service.match_all_messages(session)
    assert cleared == 1
    refreshed = session.get(MessageCache, one.id)
    assert refreshed.assignment_id is None


def test_match_all_with_lab3_pattern(session):
    _seed_messages(session)
    m = AssignmentMapping(pattern=r"^lab0?3", name="Lab 3")
    session.add(m)
    session.commit()
    session.refresh(m)
    updated = assignment_service.match_all_messages(session)
    assert updated == 2  # lab3.ipynb + lab03.ipynb tag to Lab 3
    counts = assignment_service.message_count_per_assignment(session)
    assert counts[m.id] == 2
    assert counts[None] == 3  # lab4, project1, NULL


def test_match_first_match_wins(session):
    _seed_messages(session)
    # Two mappings, both could match "lab3.ipynb"; lower id wins.
    a = AssignmentMapping(pattern=r"^lab", name="All labs")
    b = AssignmentMapping(pattern=r"^lab0?3", name="Lab 3")
    session.add(a); session.add(b)
    session.commit()
    session.refresh(a); session.refresh(b)
    assignment_service.match_all_messages(session)
    counts = assignment_service.message_count_per_assignment(session)
    # All three lab*.ipynb messages tagged with "All labs" (a, lower id)
    assert counts[a.id] == 3
    assert counts.get(b.id, 0) == 0


def test_create_assignment_endpoint_runs_retag(client, session):
    _seed_messages(session)
    r = client.post("/api/assignments", json={
        "pattern": r"^lab0?3", "name": "Lab 3", "description": "Histograms",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Lab 3"
    assert body["message_count"] == 2


def test_create_assignment_rejects_bad_regex(client):
    r = client.post("/api/assignments", json={"pattern": "[unclosed", "name": "X"})
    assert r.status_code == 400


def test_list_assignments_returns_counts(client, session):
    _seed_messages(session)
    client.post("/api/assignments", json={"pattern": r"^lab0?3", "name": "Lab 3"})
    client.post("/api/assignments", json={"pattern": r"^project", "name": "Project 1"})
    r = client.get("/api/assignments")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    by_name = {a["name"]: a for a in items}
    assert by_name["Lab 3"]["message_count"] == 2
    assert by_name["Project 1"]["message_count"] == 1


def test_unmapped_count(client, session):
    _seed_messages(session)
    r = client.get("/api/assignments/unmapped")
    body = r.json()
    assert body["total_count"] == 5
    assert body["unmapped_count"] == 5  # nothing mapped yet


def test_delete_assignment_clears_assignment_id(client, session):
    _seed_messages(session)
    created = client.post("/api/assignments", json={"pattern": r"^lab0?3", "name": "Lab 3"}).json()
    r = client.delete(f"/api/assignments/{created['id']}")
    assert r.status_code == 200
    assert r.json()["cleared"] == 2
    rows = session.exec(MessageCache.__table__.select()).all()
    for row in rows:
        assert row.assignment_id is None


def test_filter_next_message_by_assignment(client, session):
    """Verify the existing /api/single-labels/{id}/next?assignment_id=X actually filters."""
    _seed_messages(session)
    lab3 = client.post("/api/assignments", json={"pattern": r"^lab0?3", "name": "Lab 3"}).json()
    label = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{label['id']}/activate")

    # Without assignment filter: any chatlog
    r1 = client.get(f"/api/single-labels/{label['id']}/next")
    body1 = r1.json()
    assert body1 is not None
    assert body1["chatlog_id"] in (400, 401, 402, 403, 404)

    # With Lab 3 filter: only conversations 400 or 401 (lab3 / lab03)
    r2 = client.get(
        f"/api/single-labels/{label['id']}/next",
        params={"assignment_id": lab3["id"]},
    )
    body2 = r2.json()
    assert body2 is not None
    assert body2["chatlog_id"] in (400, 401)


def test_merge_two_assignments(client, session):
    _seed_messages(session)
    a = client.post("/api/assignments", json={"pattern": r"^lab0?3", "name": "Lab 3"}).json()
    b = client.post("/api/assignments", json={"pattern": r"^lab0?4", "name": "Lab 4"}).json()
    # Both should have message counts after creation
    assert a["message_count"] == 2  # lab3.ipynb + lab03.ipynb
    assert b["message_count"] == 1

    r = client.post("/api/assignments/merge", json={
        "source_ids": [b["id"]],
        "target_id": a["id"],
        "new_name": "Labs 3 & 4",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["merged"] == 1
    assert body["moved_messages"] == 1
    assert body["target_id"] == a["id"]

    # Source deleted, target renamed, all 3 lab messages now under target
    listing = client.get("/api/assignments").json()
    assert len(listing) == 1
    assert listing[0]["name"] == "Labs 3 & 4"
    assert listing[0]["message_count"] == 3


def test_merge_unions_patterns(client, session):
    _seed_messages(session)
    a = client.post("/api/assignments", json={"pattern": r"^lab0?3", "name": "Lab 3"}).json()
    b = client.post("/api/assignments", json={"pattern": r"^project", "name": "Project 1"}).json()
    client.post("/api/assignments/merge", json={
        "source_ids": [b["id"]],
        "target_id": a["id"],
    })
    listing = client.get("/api/assignments").json()
    pattern = listing[0]["pattern"]
    # Both original patterns should be in the unioned pattern
    assert "lab0?3" in pattern
    assert "project" in pattern
    # And after a re-tag pass, all four messages are still under the target
    import assignment_service as svc
    svc.match_all_messages(session)
    listing = client.get("/api/assignments").json()
    assert listing[0]["message_count"] == 3  # 2 lab + 1 project


def test_merge_rejects_self_target(client, session):
    a = client.post("/api/assignments", json={"pattern": r"^lab", "name": "Lab"}).json()
    r = client.post("/api/assignments/merge", json={
        "source_ids": [a["id"]],
        "target_id": a["id"],
    })
    assert r.status_code == 400


def test_merge_rejects_unknown_target(client, session):
    a = client.post("/api/assignments", json={"pattern": r"^lab", "name": "Lab"}).json()
    r = client.post("/api/assignments/merge", json={
        "source_ids": [a["id"]],
        "target_id": 999999,
    })
    assert r.status_code == 400
