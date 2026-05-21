"""Unit + API tests for hybrid explore / round-robin conversation sampling."""
import numpy as np
import queue_service
from sqlmodel import select

from concept_service import EMBED_MODEL
from models import LabelApplication, LabelDefinition, MessageCache, MessageEmbedding


def _emb(values):
    return np.array(values, dtype=np.float32).tobytes()


def _seed_conv_sizes(session, sizes: dict[int, int]):
    """sizes: chatlog_id -> number of student messages."""
    for cid, n in sizes.items():
        for i in range(n):
            session.add(
                MessageCache(
                    chatlog_id=cid,
                    message_index=i,
                    message_text=f"chat {cid} msg {i}",
                )
            )
    session.commit()


def test_select_next_always_baseline_when_explore_fraction_zero(session, monkeypatch):
    monkeypatch.setattr(queue_service.random, "random", lambda: 0.0)  # would explore if fraction > 0
    conv = {
        201: [(0, "a", None), (1, "b", None)],
        202: [(0, "c", None)],
    }
    cid, mode = queue_service._select_next_chatlog_id(
        session,
        label_id=1,
        conv=conv,
        assign_by_cid={201: None, 202: None},
        decided=set(),
        in_progress=[],
        not_started=[201, 202],
        explore_fraction=0.0,
    )
    assert mode == "round_robin"
    assert cid is not None


def test_select_next_continue_when_multiple_in_progress(session, monkeypatch):
    monkeypatch.setattr(queue_service.random, "random", lambda: 0.0)
    conv = {
        201: [(0, "a", None), (1, "b", None)],
        202: [(0, "c", None), (1, "d", None)],
        203: [(0, "e", None)],
    }
    decided = {(201, 0), (202, 0)}
    cid, mode = queue_service._select_next_chatlog_id(
        session,
        label_id=1,
        conv=conv,
        assign_by_cid={201: None, 202: None, 203: None},
        decided=decided,
        in_progress=[201, 202],
        not_started=[203],
        explore_fraction=0.0,
    )
    assert mode == "continue"
    assert cid in (201, 202)


def test_select_next_continue_when_single_in_progress(session):
    conv = {
        201: [(0, "a", None), (1, "b", None)],
        202: [(0, "c", None)],
        203: [(0, "d", None)],
    }
    decided = {(201, 0)}
    cid, mode = queue_service._select_next_chatlog_id(
        session,
        label_id=1,
        conv=conv,
        assign_by_cid={201: None, 202: None, 203: None},
        decided=decided,
        in_progress=[201],
        not_started=[202, 203],
        explore_fraction=0.97,
    )
    assert cid == 201
    assert mode == "continue"


def test_select_next_explore_when_fraction_one(session, monkeypatch):
    monkeypatch.setattr(queue_service.random, "random", lambda: 0.0)
    import explore_service

    conv = {
        201: [(0, "help", None)],
        202: [(0, "help", None), (1, "help", None), (2, "question 1.2", None)],
        203: [
            (
                0,
                "Can you give me an example of groupby in the context of this question?",
                None,
            )
        ],
    }
    pri_long_spam = explore_service.explore_candidate_priority(
        session, 202, "help", 0, [t for _i, t, _n in conv[202]], use_corpus_rarity=False
    )
    pri_specific = explore_service.explore_candidate_priority(
        session, 203, conv[203][0][1], 0, [conv[203][0][1]], use_corpus_rarity=False
    )
    assert pri_specific > pri_long_spam

    chosen: list[int] = []

    def _pick_one(seq):
        chosen.append(seq[0])
        return seq[0]

    monkeypatch.setattr(queue_service.random, "choice", _pick_one)
    cid, mode = queue_service._select_next_chatlog_id(
        session,
        label_id=1,
        conv=conv,
        assign_by_cid={201: None, 202: None, 203: None},
        decided=set(),
        in_progress=[],
        not_started=[201, 202, 203],
        explore_fraction=1.0,
    )
    assert mode == "explore"
    assert cid == 203


def test_next_message_includes_sampling_metadata(client, session, monkeypatch):
    monkeypatch.setenv("CHATSIGHT_HYBRID_EXPLORE_FRACTION", "0")
    _seed_conv_sizes(session, {300: 2, 301: 2})
    label = client.post("/api/single-labels", json={"name": "sampling-meta"}).json()
    client.post(f"/api/single-labels/{label['id']}/activate")
    r = client.get(f"/api/single-labels/{label['id']}/next")
    assert r.status_code == 200
    data = r.json()
    assert data["sampling_pick"] in ("continue", "round_robin", "explore")
    assert data["conversation_student_messages"] is not None
    assert data["pending_student_message_number"] is not None
    assert "explore_pick_summary" in data


def test_explore_fraction_patch_changes_effective_rate(client, session):
    lab = client.post("/api/single-labels", json={"name": "rate"}).json()
    lid = lab["id"]
    client.post(f"/api/single-labels/{lid}/activate")
    client.patch(f"/api/single-labels/{lid}", json={"hybrid_explore_fraction": 1.0})
    active = client.get("/api/single-labels/active").json()
    assert active["hybrid_explore_effective"] == 1.0


def test_compose_explore_pick_summary_plain_language(session):
    label = LabelDefinition(name="summary", mode="single", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    session.add(MessageCache(chatlog_id=500, message_index=0, message_text="focus"))
    session.commit()
    text = queue_service.compose_explore_pick_summary(
        session, label.id, 500, 0, "Can you explain groupby with a concrete example?"
    )
    assert text.startswith("Conversation was chosen because")
    assert "unique" in text.lower() or "varied" in text.lower()


def test_display_sampling_pick_explore_walk_not_continue(session):
    label = LabelDefinition(name="display-pick", mode="single", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    frozen = "Conversation was chosen because of unique student question specificity."
    queue_service._ensure_explore_pick_summary(session, label.id, 600, frozen)
    session.add(
        LabelApplication(
            label_id=label.id,
            chatlog_id=600,
            message_index=0,
            applied_by="human",
            confidence=1.0,
            value="yes",
        )
    )
    session.commit()
    assert (
        queue_service._display_sampling_pick(session, label.id, 600, "continue")
        == "explore"
    )
    session.add(
        LabelApplication(
            label_id=label.id,
            chatlog_id=601,
            message_index=0,
            applied_by="human",
            confidence=1.0,
            value="no",
        )
    )
    session.commit()
    assert (
        queue_service._display_sampling_pick(session, label.id, 600, "continue")
        == "continue"
    )


def test_explore_pick_summary_frozen_on_cursor(session):
    label = LabelDefinition(name="freeze", mode="single", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    frozen = (
        "Conversation was chosen because of unique student question specificity "
        "and uncommon course wording."
    )
    queue_service._ensure_explore_pick_summary(session, label.id, 600, frozen)
    session.commit()
    meta = queue_service.build_sampling_meta(session, label.id, 600, 1, 2, "continue")
    assert meta["explore_pick_summary"] == frozen
    queue_service._ensure_explore_pick_summary(
        session, label.id, 600, "Conversation was chosen because of unique something else."
    )
    session.commit()
    meta2 = queue_service.build_sampling_meta(session, label.id, 600, 1, 2, "continue")
    assert meta2["explore_pick_summary"] == frozen


def test_explore_walk_msg2_stays_explore_after_decide(client, session, monkeypatch):
    """Frozen explore summary and display pick must survive the next HTTP request."""
    monkeypatch.setenv("CHATSIGHT_HYBRID_EXPLORE_FRACTION", "1")
    monkeypatch.setattr(queue_service.random, "random", lambda: 0.0)
    for cid in (700, 701):
        for i in range(3):
            session.add(
                MessageCache(
                    chatlog_id=cid,
                    message_index=i,
                    message_text=f"chat {cid} msg {i} with enough words for scoring",
                )
            )
    session.commit()
    label = client.post("/api/single-labels", json={"name": "explore-walk"}).json()
    lid = label["id"]
    client.post(f"/api/single-labels/{lid}/activate")
    first = client.get(f"/api/single-labels/{lid}/next").json()
    assert first is not None
    assert first["sampling_pick"] == "explore"
    assert first["explore_pick_summary"]
    cid = first["chatlog_id"]
    session.expire_all()
    body = client.post(
        f"/api/single-labels/{lid}/decide",
        json={
            "chatlog_id": cid,
            "message_index": first["message_index"],
            "value": "skip",
        },
    ).json()
    assert body["next"] is not None
    nxt = body["next"]
    assert nxt["chatlog_id"] == cid
    assert nxt["sampling_pick"] == "explore"
    assert nxt["explore_pick_summary"] == first["explore_pick_summary"]
    assert nxt["pending_student_message_number"] == first["pending_student_message_number"] + 1


def test_decide_response_carries_sampling_on_next(client, session, monkeypatch):
    monkeypatch.setenv("CHATSIGHT_HYBRID_EXPLORE_FRACTION", "0")
    _seed_conv_sizes(session, {400: 1, 401: 1})
    label = client.post("/api/single-labels", json={"name": "decide-sampling"}).json()
    lid = label["id"]
    client.post(f"/api/single-labels/{lid}/activate")
    first = client.get(f"/api/single-labels/{lid}/next").json()
    r = client.post(
        f"/api/single-labels/{lid}/decide",
        json={
            "chatlog_id": first["chatlog_id"],
            "message_index": first["message_index"],
            "value": "yes",
        },
    )
    assert r.status_code == 200
    body = r.json()
    nxt = body.get("next")
    if nxt is not None:
        assert "sampling_pick" in nxt
        assert "sampling_hint" in nxt
