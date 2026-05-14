from sqlmodel import Session, select
from fastapi.testclient import TestClient
from models import LabelDefinition, LabelApplication


def _seed_label_with_rows(session, yes=10, no=5, review=2, human_gold=25):
    label = LabelDefinition(
        name="self-correction",
        description="catches own mistake",
        mode="single",
        phase="handed_off",
    )
    session.add(label)
    session.commit()
    session.refresh(label)

    # AI rows above threshold (default 0.7)
    for i in range(yes):
        session.add(LabelApplication(
            label_id=label.id, chatlog_id=i, message_index=0,
            applied_by="ai", value="yes", confidence=0.85,
        ))
    for i in range(no):
        session.add(LabelApplication(
            label_id=label.id, chatlog_id=1000 + i, message_index=0,
            applied_by="ai", value="no", confidence=0.85,
        ))
    # AI rows below threshold → land in Review bucket
    for i in range(review):
        session.add(LabelApplication(
            label_id=label.id, chatlog_id=2000 + i, message_index=0,
            applied_by="ai", value="yes", confidence=0.55,
        ))
    # Human "gold" rows: human-applied, with AI snapshot. Used for agreement metric.
    for i in range(human_gold):
        session.add(LabelApplication(
            label_id=label.id, chatlog_id=3000 + i, message_index=0,
            applied_by="human", value="yes",
            ai_value_at_review="yes",  # agree
        ))
    session.commit()
    return label


def test_get_label_detail_returns_counts_and_agreement(client: TestClient, session: Session):
    label = _seed_label_with_rows(session)
    r = client.get(f"/api/single-labels/{label.id}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == label.id
    assert body["name"] == "self-correction"
    assert body["review_threshold"] == 0.7
    assert body["yes_count"] == 35  # 10 AI-yes above threshold + 25 human-yes
    assert body["no_count"] == 5
    assert body["review_count"] == 2
    assert body["agreement_vs_gold"] == 1.0  # all 25 gold rows agree
    assert isinstance(body["confidence_histogram"], list)
    assert len(body["confidence_histogram"]) == 10
    # bin 8 = confidence [0.80, 0.90): 10 AI-yes + 5 AI-no at 0.85
    assert body["confidence_histogram"][8]["count"] == 15
    # bin 5 = confidence [0.50, 0.60): 2 review-bucket AI rows at 0.55
    assert body["confidence_histogram"][5]["count"] == 2


def test_get_label_detail_suppresses_agreement_when_gold_too_small(client, session):
    label = _seed_label_with_rows(session, human_gold=5)
    r = client.get(f"/api/single-labels/{label.id}")
    assert r.json()["agreement_vs_gold"] is None


def test_get_label_detail_404_for_multi_mode_label(client, session):
    label = LabelDefinition(name="multi-mode", mode="multi", phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    r = client.get(f"/api/single-labels/{label.id}")
    assert r.status_code == 404


def test_get_label_detail_zero_rows(client, session):
    """A handed-off label with no AI rows yet returns all-zero counts
    and agreement_vs_gold=None without errors."""
    label = LabelDefinition(name="empty", mode="single", phase="handed_off")
    session.add(label)
    session.commit()
    session.refresh(label)
    r = client.get(f"/api/single-labels/{label.id}")
    assert r.status_code == 200
    body = r.json()
    assert body["yes_count"] == 0
    assert body["no_count"] == 0
    assert body["review_count"] == 0
    assert body["agreement_vs_gold"] is None
    assert len(body["confidence_histogram"]) == 10
    assert all(b["count"] == 0 for b in body["confidence_histogram"])


def test_list_messages_default_sort_confidence_ascending(client, session):
    label = _seed_label_with_rows(session)
    r = client.get(f"/api/single-labels/{label.id}/messages?limit=200")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    confidences = [it["confidence"] for it in items if it["confidence"] is not None]
    assert confidences == sorted(confidences)  # ascending


def test_list_messages_filter_yes_excludes_review_bucket(client, session):
    label = _seed_label_with_rows(session)
    r = client.get(f"/api/single-labels/{label.id}/messages?bucket=yes&limit=200")
    items = r.json()["items"]
    assert len(items) > 0
    assert all(it["verdict"] == "yes" for it in items)


def test_list_messages_filter_review(client, session):
    label = _seed_label_with_rows(session)
    r = client.get(f"/api/single-labels/{label.id}/messages?bucket=review&limit=200")
    items = r.json()["items"]
    assert all(it["verdict"] == "review" for it in items)
    assert len(items) == 2  # _seed_label_with_rows creates 2 review-bucket rows


def test_list_messages_pagination(client, session):
    label = _seed_label_with_rows(session, yes=30, no=0, review=0, human_gold=0)
    r = client.get(f"/api/single-labels/{label.id}/messages?offset=10&limit=10")
    body = r.json()
    assert body["total"] == 30
    assert body["offset"] == 10
    assert body["limit"] == 10
    assert len(body["items"]) == 10


def test_list_messages_search_substring(client, session):
    from models import LabelDefinition, LabelApplication, MessageCache
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)
    session.add(MessageCache(chatlog_id=1, message_index=0, message_text="wait, I misread"))
    session.add(MessageCache(chatlog_id=2, message_index=0, message_text="can you help"))
    session.add(LabelApplication(label_id=label.id, chatlog_id=1, message_index=0,
                                 applied_by="ai", value="yes", confidence=0.85))
    session.add(LabelApplication(label_id=label.id, chatlog_id=2, message_index=0,
                                 applied_by="ai", value="no", confidence=0.85))
    session.commit()
    r = client.get(f"/api/single-labels/{label.id}/messages?search=misread")
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["chatlog_id"] == 1


def test_list_messages_rejects_unknown_bucket(client, session):
    label = _seed_label_with_rows(session)
    r = client.get(f"/api/single-labels/{label.id}/messages?bucket=foobar")
    assert r.status_code == 422


def test_list_messages_rejects_oversized_limit(client, session):
    label = _seed_label_with_rows(session)
    r = client.get(f"/api/single-labels/{label.id}/messages?limit=10000")
    assert r.status_code == 422  # FastAPI Query(le=500) rejects this


def test_message_detail_returns_focused_message_and_surrounding_turns(client, session, monkeypatch):
    from models import LabelDefinition, LabelApplication, MessageCache

    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)

    session.add(MessageCache(
        chatlog_id=42, message_index=0, message_text="focused student message",
    ))
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=42, message_index=0,
        applied_by="ai", value="yes", confidence=0.58,
        matched_pattern="questioning own work",
        rationale="Student explicitly recognizes a misread.",
    ))
    session.commit()

    # Stub the external-DB conversation fetcher: mimics _fetch_conversation_events shape
    def fake_fetch(conn, chatlog_id):
        return [
            {"event_type": "tutor_query", "question": "previous student turn",
             "response": None, "notebook": "lab02"},
            {"event_type": "tutor_response", "question": None,
             "response": "Try aggfunc='median' instead.", "notebook": "lab02"},
            {"event_type": "tutor_query", "question": "focused student message",
             "response": None, "notebook": "lab02"},
            {"event_type": "tutor_response", "question": None,
             "response": "Great — re-run and check.", "notebook": "lab02"},
        ]

    monkeypatch.setattr("main._fetch_conversation_events", fake_fetch)

    r = client.get(f"/api/single-labels/{label.id}/messages/42?context=1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["text"] == "focused student message"
    assert body["matched_pattern"] == "questioning own work"
    assert body["rationale"].startswith("Student explicitly")
    assert body["confidence"] == 0.58
    # ±1 tutor turn — one before, one after
    assert len(body["context_before"]) == 1
    assert body["context_before"][0]["role"] == "tutor"
    assert "median" in body["context_before"][0]["text"]
    assert len(body["context_after"]) == 1
    assert body["context_after"][0]["text"].startswith("Great")


def test_message_detail_404_when_no_application_row(client, session):
    from models import LabelDefinition
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)
    r = client.get(f"/api/single-labels/{label.id}/messages/999")
    assert r.status_code == 404


def test_message_detail_404_when_label_id_not_found(client, session):
    r = client.get("/api/single-labels/99999/messages/1")
    assert r.status_code == 404


def test_message_detail_404_when_label_is_multi_mode(client, session):
    from models import LabelDefinition
    multi_label = LabelDefinition(name="multi", mode="multi", phase="labeling")
    session.add(multi_label); session.commit(); session.refresh(multi_label)
    r = client.get(f"/api/single-labels/{multi_label.id}/messages/1")
    assert r.status_code == 404


def test_flip_verdict_snapshots_prior_ai_value(client, session):
    from models import LabelDefinition, LabelApplication
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=42, message_index=0,
        applied_by="ai", value="yes", confidence=0.58,
    ))
    session.commit()

    r = client.patch(
        f"/api/single-labels/{label.id}/applications/42",
        params={"message_index": 0},
        json={"verdict": "no"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] == "no"
    assert body["applied_by"] == "human"

    row = session.exec(
        select(LabelApplication).where(LabelApplication.chatlog_id == 42)
    ).one()
    assert row.value == "no"
    assert row.applied_by == "human"
    assert row.ai_value_at_review == "yes"
    assert row.ai_confidence_at_review == 0.58


def test_flip_verdict_does_not_overwrite_existing_snapshot(client, session):
    """Re-flipping shouldn't lose the original AI verdict snapshot."""
    from models import LabelDefinition, LabelApplication
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=42, message_index=0,
        applied_by="human", value="no", confidence=None,
        ai_value_at_review="yes", ai_confidence_at_review=0.58,
    ))
    session.commit()

    r = client.patch(
        f"/api/single-labels/{label.id}/applications/42",
        params={"message_index": 0},
        json={"verdict": "yes"},
    )
    assert r.status_code == 200

    row = session.exec(
        select(LabelApplication).where(LabelApplication.chatlog_id == 42)
    ).one()
    assert row.value == "yes"
    assert row.ai_value_at_review == "yes"  # unchanged
    assert row.ai_confidence_at_review == 0.58  # unchanged


def test_flip_verdict_404_when_no_application_row(client, session):
    from models import LabelDefinition
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)
    r = client.patch(
        f"/api/single-labels/{label.id}/applications/999",
        params={"message_index": 0},
        json={"verdict": "no"},
    )
    assert r.status_code == 404


def test_flip_verdict_422_for_invalid_value(client, session):
    from models import LabelDefinition, LabelApplication
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=42, message_index=0,
        applied_by="ai", value="yes", confidence=0.58,
    ))
    session.commit()
    r = client.patch(
        f"/api/single-labels/{label.id}/applications/42",
        params={"message_index": 0},
        json={"verdict": "maybe"},
    )
    assert r.status_code == 422


def test_flip_verdict_404_when_label_is_multi_mode(client, session):
    from models import LabelDefinition, LabelApplication
    multi_label = LabelDefinition(name="multi", mode="multi", phase="labeling")
    session.add(multi_label); session.commit(); session.refresh(multi_label)
    session.add(LabelApplication(
        label_id=multi_label.id, chatlog_id=42, message_index=0,
        applied_by="ai", value="yes", confidence=0.8,
    ))
    session.commit()
    r = client.patch(
        f"/api/single-labels/{multi_label.id}/applications/42",
        params={"message_index": 0},
        json={"verdict": "no"},
    )
    assert r.status_code == 404


def test_upsert_note_sets_field(client, session):
    from models import LabelDefinition, LabelApplication
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=42, message_index=0,
        applied_by="ai", value="yes", confidence=0.8,
    ))
    session.commit()

    r = client.put(
        f"/api/single-labels/{label.id}/applications/42/note",
        params={"message_index": 0},
        json={"text": "not really self-correction"},
    )
    assert r.status_code == 200, r.text

    row = session.exec(
        select(LabelApplication).where(LabelApplication.chatlog_id == 42)
    ).one()
    assert row.note == "not really self-correction"


def test_upsert_note_empty_string_clears(client, session):
    from models import LabelDefinition, LabelApplication
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=42, message_index=0,
        applied_by="ai", value="yes", confidence=0.8,
        note="existing note",
    ))
    session.commit()

    client.put(
        f"/api/single-labels/{label.id}/applications/42/note",
        params={"message_index": 0},
        json={"text": ""},
    )

    row = session.exec(
        select(LabelApplication).where(LabelApplication.chatlog_id == 42)
    ).one()
    assert row.note is None


def test_upsert_note_404_when_no_row(client, session):
    from models import LabelDefinition
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)
    r = client.put(
        f"/api/single-labels/{label.id}/applications/999/note",
        params={"message_index": 0},
        json={"text": "hi"},
    )
    assert r.status_code == 404


def test_upsert_note_404_when_label_is_multi_mode(client, session):
    from models import LabelDefinition, LabelApplication
    multi = LabelDefinition(name="multi", mode="multi", phase="labeling")
    session.add(multi); session.commit(); session.refresh(multi)
    session.add(LabelApplication(
        label_id=multi.id, chatlog_id=42, message_index=0,
        applied_by="ai", value="yes", confidence=0.8,
    ))
    session.commit()
    r = client.put(
        f"/api/single-labels/{multi.id}/applications/42/note",
        params={"message_index": 0},
        json={"text": "hi"},
    )
    assert r.status_code == 404


def test_patch_label_updates_name_description_threshold(client, session):
    from models import LabelDefinition
    label = LabelDefinition(name="old", description=None, mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)

    r = client.patch(
        f"/api/single-labels/{label.id}",
        json={"name": "new", "description": "d", "review_threshold": 0.6},
    )
    assert r.status_code == 200, r.text

    session.expire_all()
    refreshed = session.get(LabelDefinition, label.id)
    assert refreshed.name == "new"
    assert refreshed.description == "d"
    assert refreshed.review_threshold == 0.6


def test_patch_label_partial_only_threshold(client, session):
    from models import LabelDefinition
    label = LabelDefinition(name="orig", description="orig-desc", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)

    r = client.patch(
        f"/api/single-labels/{label.id}",
        json={"review_threshold": 0.55},
    )
    assert r.status_code == 200

    session.expire_all()
    refreshed = session.get(LabelDefinition, label.id)
    assert refreshed.name == "orig"  # untouched
    assert refreshed.description == "orig-desc"  # untouched
    assert refreshed.review_threshold == 0.55


def test_patch_label_404_when_multi_mode(client, session):
    from models import LabelDefinition
    multi = LabelDefinition(name="multi", mode="multi", phase="labeling")
    session.add(multi); session.commit(); session.refresh(multi)
    r = client.patch(f"/api/single-labels/{multi.id}", json={"name": "x"})
    assert r.status_code == 404


def test_delete_label_archives(client, session):
    from models import LabelDefinition
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)
    r = client.delete(f"/api/single-labels/{label.id}")
    assert r.status_code == 200

    session.expire_all()
    refreshed = session.get(LabelDefinition, label.id)
    assert refreshed.archived_at is not None


def test_delete_label_404_when_multi_mode(client, session):
    from models import LabelDefinition
    multi = LabelDefinition(name="multi", mode="multi", phase="labeling")
    session.add(multi); session.commit(); session.refresh(multi)
    r = client.delete(f"/api/single-labels/{multi.id}")
    assert r.status_code == 404


def test_patch_label_422_when_threshold_out_of_range(client, session):
    from models import LabelDefinition
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    session.add(label); session.commit(); session.refresh(label)

    r = client.patch(f"/api/single-labels/{label.id}", json={"review_threshold": 1.5})
    assert r.status_code == 422

    r2 = client.patch(f"/api/single-labels/{label.id}", json={"review_threshold": -0.1})
    assert r2.status_code == 422
