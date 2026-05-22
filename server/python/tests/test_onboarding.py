"""Onboarding starter pick, label suggestions, and seed-first queue."""
from onboarding_service import pick_starter_conversation, rule_based_label_suggestions
from sqlmodel import select

from models import LabelApplication, MessageCache, OnboardingStarterCache


def _seed_rich_corpus(session):
    """Specific conv wins over paste-heavy generic conv."""
    session.add(
        MessageCache(
            chatlog_id=400,
            message_index=0,
            message_text="help",
            assignment_id=1,
        )
    )
    session.add(
        MessageCache(
            chatlog_id=400,
            message_index=1,
            message_text="help",
        )
    )
    for midx, text in enumerate(
        [
            "How do I use groupby so the mean is computed per section, not globally?",
            "I tried df.groupby('section') but my column stays NaN — what did I miss?",
            "Can you explain why reset_index changes the shape here?",
        ]
    ):
        session.add(
            MessageCache(
                chatlog_id=401,
                message_index=midx,
                message_text=text,
                assignment_id=2,
                notebook="hw2.ipynb",
            )
        )
    pasted = "Question 1.2\n" + ("Write a function that returns the sum.\n" * 8)
    session.add(
        MessageCache(
            chatlog_id=402,
            message_index=0,
            message_text=pasted,
            assignment_id=3,
        )
    )
    session.commit()


def test_rule_label_suggestions_paste():
    pasted = "Question 1.2\n" + ("Write a function that returns the sum.\n" * 8)
    names = rule_based_label_suggestions(pasted)
    assert any("paste" in n.lower() for n in names)
    assert all(len(n) < 40 for n in names)


def test_pick_starter_prefers_specific_conversation(session):
    _seed_rich_corpus(session)
    payload = pick_starter_conversation(session, force_refresh=True)
    assert payload is not None
    assert payload["chatlog_id"] == 401
    assert len(payload["preview_turns"]) == 3
    assert all(t["suggested_label_names"] for t in payload["preview_turns"])


def test_starter_cached_until_corpus_changes(session):
    _seed_rich_corpus(session)
    first = pick_starter_conversation(session, force_refresh=True)
    second = pick_starter_conversation(session)
    assert first["chatlog_id"] == second["chatlog_id"]
    cache = session.get(OnboardingStarterCache, 1)
    assert cache is not None
    assert cache.chatlog_id == 401


def test_onboarding_starter_endpoint(client, session):
    _seed_rich_corpus(session)
    r = client.get("/api/onboarding/starter")
    assert r.status_code == 200
    body = r.json()
    assert body["chatlog_id"] == 401
    assert body["seed_message_index"] == 0
    assert len(body["preview_turns"]) == 3


def test_create_single_label_with_seed(client, session):
    _seed_rich_corpus(session)
    r = client.post(
        "/api/single-labels",
        json={
            "name": "concept question",
            "seed_chatlog_id": 401,
            "seed_message_index": 0,
        },
    )
    assert r.status_code == 200
    label_id = r.json()["id"]
    client.post(f"/api/single-labels/{label_id}/activate")
    nxt = client.get(f"/api/single-labels/{label_id}/next")
    assert nxt.status_code == 200
    body = nxt.json()
    assert body["chatlog_id"] == 401
    assert body["message_index"] == 0
    assert "groupby" in body["text"]


def test_seed_only_before_first_decision(client, session):
    _seed_rich_corpus(session)
    label = client.post(
        "/api/single-labels",
        json={"name": "help", "seed_chatlog_id": 401, "seed_message_index": 0},
    ).json()
    client.post(f"/api/single-labels/{label['id']}/activate")
    first = client.get(f"/api/single-labels/{label['id']}/next").json()
    assert first["chatlog_id"] == 401
    client.post(
        f"/api/single-labels/{label['id']}/decide",
        json={"chatlog_id": 401, "message_index": 0, "value": "yes"},
    )
    second = client.get(f"/api/single-labels/{label['id']}/next").json()
    assert second is not None
    apps = session.exec(select(LabelApplication)).all()
    assert len(apps) == 1
