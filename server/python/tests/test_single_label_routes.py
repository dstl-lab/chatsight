"""End-to-end tests for the single-label binary flow via FastAPI."""
import queue_service
from sqlmodel import select

from models import LabelApplication, LabelDefinition, MessageCache


def _seed_messages(session, conversations=3, per_conv=4):
    for c in range(conversations):
        for i in range(per_conv):
            session.add(MessageCache(
                chatlog_id=200 + c,
                message_index=i,
                message_text=f"conv {200 + c} msg {i}",
            ))
    session.commit()


def test_create_single_label(client):
    r = client.post("/api/single-labels", json={"name": "help", "description": "needs help"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "help"
    assert data["mode"] == "single"
    assert data["phase"] == "labeling"
    assert data["is_active"] is False


def test_list_excludes_multi_labels(client, session):
    session.add(LabelDefinition(name="multi-thing", mode="multi"))
    session.commit()
    client.post("/api/single-labels", json={"name": "single-thing"})
    r = client.get("/api/single-labels")
    assert r.status_code == 200
    names = [lab["name"] for lab in r.json()]
    assert "single-thing" in names
    assert "multi-thing" not in names


def test_existing_labels_endpoint_excludes_single_mode(client, session):
    session.add(LabelDefinition(name="multi-thing", mode="multi"))
    session.add(LabelDefinition(name="single-thing", mode="single"))
    session.commit()
    r = client.get("/api/labels")
    assert r.status_code == 200
    names = [lab["name"] for lab in r.json()]
    assert "multi-thing" in names
    assert "single-thing" not in names


def test_activate_makes_label_active(client):
    r = client.post("/api/single-labels", json={"name": "help"})
    label_id = r.json()["id"]
    r2 = client.post(f"/api/single-labels/{label_id}/activate")
    assert r2.status_code == 200
    assert r2.json()["is_active"] is True


def test_activate_deactivates_others(client):
    a = client.post("/api/single-labels", json={"name": "a"}).json()
    b = client.post("/api/single-labels", json={"name": "b"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")
    client.post(f"/api/single-labels/{b['id']}/activate")
    r = client.get("/api/single-labels/active")
    assert r.json()["id"] == b["id"]


def test_decide_records_value(client, session):
    _seed_messages(session)
    label = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{label['id']}/activate")
    r = client.post(
        f"/api/single-labels/{label['id']}/decide",
        json={"chatlog_id": 200, "message_index": 0, "value": "yes"},
    )
    assert r.status_code == 200
    apps = session.exec(select(LabelApplication)).all()
    assert len(apps) == 1
    assert apps[0].value == "yes"


def test_decide_rejects_bad_value(client, session):
    _seed_messages(session)
    label = client.post("/api/single-labels", json={"name": "help"}).json()
    r = client.post(
        f"/api/single-labels/{label['id']}/decide",
        json={"chatlog_id": 200, "message_index": 0, "value": "perhaps"},
    )
    assert r.status_code == 400


def test_readiness_endpoint(client, session):
    _seed_messages(session, conversations=3, per_conv=4)
    label = client.post("/api/single-labels", json={"name": "help"}).json()
    r = client.get(f"/api/single-labels/{label['id']}/readiness")
    assert r.status_code == 200
    state = r.json()
    assert state["tier"] == "gray"  # no decisions yet
    assert state["yes_count"] == 0
    assert state["total_conversations"] == 3


def test_queue_label_creates_with_phase_queued(client):
    label = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{label['id']}/activate")
    r = client.post("/api/single-labels/queue", json={"name": "frustration"})
    assert r.status_code == 200
    data = r.json()
    assert data["phase"] == "queued"
    assert data["queue_position"] == 0


def test_queue_label_is_idempotent_on_name(client):
    client.post("/api/single-labels/queue", json={"name": "frustration"})
    r2 = client.post("/api/single-labels/queue", json={"name": "frustration"})
    assert r2.status_code == 200
    queued = client.get("/api/single-labels", params={"phase": "queued"}).json()
    names = [q["name"] for q in queued]
    assert names.count("frustration") == 1


def test_close_auto_pops_next_queued(client):
    active = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{active['id']}/activate")
    queued = client.post("/api/single-labels/queue", json={"name": "frustration"}).json()
    r = client.post(f"/api/single-labels/{active['id']}/close")
    assert r.status_code == 200
    # The previously-queued label should now be active
    r2 = client.get("/api/single-labels/active")
    body = r2.json()
    assert body is not None
    assert body["id"] == queued["id"]
    assert body["phase"] == "labeling"
    assert body["queue_position"] is None


def test_undo_removes_last_decision(client, session):
    _seed_messages(session)
    label = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{label['id']}/activate")
    client.post(
        f"/api/single-labels/{label['id']}/decide",
        json={"chatlog_id": 200, "message_index": 0, "value": "yes"},
    )
    client.post(
        f"/api/single-labels/{label['id']}/decide",
        json={"chatlog_id": 200, "message_index": 1, "value": "no"},
    )
    client.post(f"/api/single-labels/{label['id']}/undo")
    apps = session.exec(select(LabelApplication)).all()
    assert len(apps) == 1
    assert apps[0].message_index == 0


def test_delete_single_label_cascades(client, session):
    _seed_messages(session)
    label = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{label['id']}/activate")
    client.post(
        f"/api/single-labels/{label['id']}/decide",
        json={"chatlog_id": 200, "message_index": 0, "value": "yes"},
    )
    r = client.delete(f"/api/single-labels/{label['id']}")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    apps = session.exec(select(LabelApplication)).all()
    assert apps == []


def test_per_label_walk_order_differs(client, session):
    """Two labels backed by the same conversation pool should walk conversations
    in different orders thanks to the per-label deterministic shuffle."""
    # Many conversations so the order spread is meaningful
    for c in range(20):
        for i in range(2):
            session.add(MessageCache(
                chatlog_id=500 + c,
                message_index=i,
                message_text=f"conv {c} msg {i}",
            ))
    session.commit()

    a = client.post("/api/single-labels", json={"name": "label-a"}).json()
    b = client.post("/api/single-labels", json={"name": "label-b"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    # Walk first 5 conversations for each label, recording the chatlog order
    def walk_order(label_id):
        order = []
        for _ in range(5):
            r = client.get(f"/api/single-labels/{label_id}/next").json()
            if not r:
                break
            order.append(r["chatlog_id"])
            client.post(
                f"/api/single-labels/{label_id}/decide",
                json={"chatlog_id": r["chatlog_id"], "message_index": r["message_index"], "value": "yes"},
            )
            # Decide the second message too, so the conversation finishes and
            # the next request advances to a new chatlog
            client.post(
                f"/api/single-labels/{label_id}/decide",
                json={"chatlog_id": r["chatlog_id"], "message_index": 1, "value": "no"},
            )
        return order

    order_a = walk_order(a["id"])
    # Reset by switching active to b — its decisions are independent
    client.post(f"/api/single-labels/{b['id']}/activate")
    order_b = walk_order(b["id"])

    assert order_a != order_b, f"Both labels walked same order: {order_a}"


def test_per_label_walk_order_is_deterministic(client, session):
    """The same label always walks in the same order — useful for resume."""
    for c in range(10):
        session.add(MessageCache(
            chatlog_id=600 + c, message_index=0, message_text=f"conv {c}",
        ))
    session.commit()
    a = client.post("/api/single-labels", json={"name": "label-a"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    first = client.get(f"/api/single-labels/{a['id']}/next").json()["chatlog_id"]
    again = client.get(f"/api/single-labels/{a['id']}/next").json()["chatlog_id"]
    assert first == again


def test_skip_conversation_endpoint_jumps_to_next_conversation(client, session):
    for c in range(2):
        for i in range(3):
            session.add(MessageCache(
                chatlog_id=700 + c, message_index=i, message_text=f"c{c}m{i}",
            ))
    session.commit()
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    first = client.get(f"/api/single-labels/{a['id']}/next").json()
    starting_cid = first["chatlog_id"]

    r = client.post(
        f"/api/single-labels/{a['id']}/skip-conversation",
        json={"chatlog_id": starting_cid},
    )
    assert r.status_code == 200
    body = r.json()
    assert body is not None
    assert body["chatlog_id"] != starting_cid

    # The skipped conversation now has 3 skip rows for the active label
    skips = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.chatlog_id == starting_cid,
        )
    ).all()
    assert len(skips) == 3
    assert all(r.value == "skip" for r in skips)


def test_next_focused_fallback_includes_tutor_from_cache(client, session, monkeypatch):
    """When Postgres thread fetch fails, rebuild thread from MessageCache including tutor snippets."""
    monkeypatch.setattr(queue_service, "_fetch_full_thread", lambda chatlog_id: [])

    session.add(MessageCache(
        chatlog_id=910,
        message_index=0,
        message_text="first student question",
        context_before=None,
        context_after="tutor reply after first",
    ))
    session.add(MessageCache(
        chatlog_id=910,
        message_index=1,
        message_text="second student question",
        context_before="tutor reply after first",
        context_after="tutor reply after second",
    ))
    session.commit()

    label = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{label['id']}/activate")
    r = client.get(f"/api/single-labels/{label['id']}/next")
    assert r.status_code == 200
    data = r.json()
    roles = [t["role"] for t in data["thread"]]
    assert roles == ["student", "tutor", "student", "tutor"]
    blob = "\n".join(t["text"] for t in data["thread"])
    assert "tutor reply after first" in blob
    assert "tutor reply after second" in blob
    assert data["focus_index"] == 0
