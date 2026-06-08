"""Tests for the three autolabel / explore-fraction fixes validated post user-study:

1. _run_autolabel now skips archived multi-labels (archived_at IS NOT NULL).
2. _run_autolabel now uses MessageCache + QUEUE_SCOPE filter instead of the
   external PostgreSQL CTE (no ext_engine calls during autolabel).
3. default_hybrid_explore_fraction() returns 0.75 (was 0.35).
"""
from datetime import datetime
from unittest.mock import patch

import main
import queue_service
import autolabel_service
from models import LabelApplication, LabelDefinition, MessageCache


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_label(session, name, mode="multi", archived=False, **kw):
    lbl = LabelDefinition(
        name=name,
        mode=mode,
        archived_at=datetime.utcnow() if archived else None,
        **kw,
    )
    session.add(lbl)
    session.commit()
    session.refresh(lbl)
    return lbl


def _seed_msg(session, chatlog_id, message_index, notebook=None, text=None):
    session.add(MessageCache(
        chatlog_id=chatlog_id,
        message_index=message_index,
        message_text=text or f"msg {chatlog_id}.{message_index}",
        notebook=notebook,
    ))
    session.commit()


# ── 1. Archived-label exclusion ───────────────────────────────────────────────

def test_autolabel_excludes_archived_labels(session, engine, monkeypatch):
    """_run_autolabel must not send archived labels to Gemini and must not write
    LabelApplication rows for them."""
    monkeypatch.setattr(main, "engine", engine)

    active = _make_label(session, "active-label")
    _make_label(session, "archived-label", archived=True)
    _seed_msg(session, 1, 0, notebook="lab01.ipynb", text="help me")

    label_defs_seen = []

    def fake_classify(label_defs, examples_by_label, messages):
        label_defs_seen.extend(label_defs)
        return [{"index": 0, "label": label_defs[0]["name"], "confidence": 0.9}]

    monkeypatch.setattr(autolabel_service, "classify_batch", fake_classify)

    main._run_autolabel()

    names_sent = {d["name"] for d in label_defs_seen}
    assert "active-label" in names_sent, "Active label should be sent to classify_batch"
    assert "archived-label" not in names_sent, "Archived label must NOT be sent to classify_batch"

    ai_apps = session.exec(
        __import__("sqlmodel", fromlist=["select"]).select(LabelApplication)
        .where(LabelApplication.applied_by == "ai")
    ).all()
    written_label_ids = {a.label_id for a in ai_apps}
    assert active.id in written_label_ids or len(ai_apps) == 0  # depends on fake return
    assert not any(a.label_id != active.id for a in ai_apps), (
        "No AI application should reference an archived label"
    )


# ── 2. Study-scope filtering: only Week 3 messages should be classified ────────

def test_autolabel_scopes_to_queue_scope(session, engine, monkeypatch):
    """_run_autolabel must restrict candidates to QUEUE_SCOPE (Week 3: Lab 1, HW 1).
    Week 8 messages in MessageCache must be excluded."""
    monkeypatch.setenv("CHATSIGHT_STUDY_LOCK", "1")
    monkeypatch.setattr(main, "engine", engine)

    _make_label(session, "scope-label")
    # In scope: Week 3
    _seed_msg(session, 10, 0, notebook="lab01.ipynb", text="in scope")
    _seed_msg(session, 11, 0, notebook="hw01.ipynb", text="also in scope")
    # Out of scope: Week 8 (single-label week) and unlocked weeks
    _seed_msg(session, 20, 0, notebook="lab05.ipynb", text="week 8 – out of scope")
    _seed_msg(session, 21, 0, notebook=None, text="no notebook – out of scope")

    messages_sent = []

    def fake_classify(label_defs, examples_by_label, messages):
        messages_sent.extend(messages)
        return []

    monkeypatch.setattr(autolabel_service, "classify_batch", fake_classify)
    main._run_autolabel()

    sent_cids = {m["chatlog_id"] for m in messages_sent}
    assert 10 in sent_cids, "Week 3 lab1 message must be classified"
    assert 11 in sent_cids, "Week 3 hw1 message must be classified"
    assert 20 not in sent_cids, "Week 8 message must not be classified"
    assert 21 not in sent_cids, "Message with no notebook must not be classified"


# ── 3. No external-DB queries during autolabel (MessageCache used instead) ────

def test_autolabel_does_not_query_external_db(session, engine, monkeypatch):
    """After the fix, _run_autolabel must not call ext_engine.connect() at all.
    All data comes from local MessageCache."""
    monkeypatch.setattr(main, "engine", engine)

    _make_label(session, "no-ext-label")
    _seed_msg(session, 5, 0, notebook="lab01.ipynb", text="test msg")

    ext_connect_calls = []

    class _FakeConn:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def execute(self, *a, **kw): raise AssertionError("ext_engine.execute called — should not happen")

    def _fake_connect():
        ext_connect_calls.append(1)
        return _FakeConn()

    monkeypatch.setattr(main.ext_engine, "connect", _fake_connect)

    # Autolabel should still succeed (no external DB calls)
    def fake_classify(label_defs, examples_by_label, messages):
        return []

    monkeypatch.setattr(autolabel_service, "classify_batch", fake_classify)
    main._run_autolabel()

    assert ext_connect_calls == [], (
        "_run_autolabel called ext_engine.connect — it should use MessageCache instead"
    )
    assert main._autolabel_status["error"] is None, (
        f"autolabel should complete without error; got: {main._autolabel_status['error']}"
    )


# ── 4. Explore fraction default ───────────────────────────────────────────────

def test_explore_fraction_default_is_75_pct(monkeypatch):
    """default_hybrid_explore_fraction() should return 0.75 when no env override."""
    monkeypatch.delenv("CHATSIGHT_HYBRID_EXPLORE_FRACTION", raising=False)
    assert queue_service.default_hybrid_explore_fraction() == 0.75


def test_explore_fraction_env_override_still_works(monkeypatch):
    """The env variable override must still function after the default change."""
    monkeypatch.setenv("CHATSIGHT_HYBRID_EXPLORE_FRACTION", "0.5")
    assert queue_service.default_hybrid_explore_fraction() == 0.5
