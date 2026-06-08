"""Tests for multi-label auto-labeling (multi_select + confidence threshold)."""
import autolabel_service


def test_multilabel_threshold_default_is_half(monkeypatch):
    monkeypatch.delenv("CHATSIGHT_MULTILABEL_THRESHOLD", raising=False)
    # Re-read the env the same way the module does at import.
    import importlib
    importlib.reload(autolabel_service)
    assert autolabel_service.MULTILABEL_THRESHOLD == 0.5


def test_multilabel_threshold_env_override(monkeypatch):
    monkeypatch.setenv("CHATSIGHT_MULTILABEL_THRESHOLD", "0.3")
    import importlib
    importlib.reload(autolabel_service)
    assert autolabel_service.MULTILABEL_THRESHOLD == 0.3
    # monkeypatch restores the env on teardown but can't un-reload the module;
    # reload with the var absent so MULTILABEL_THRESHOLD resets for later tests.
    monkeypatch.delenv("CHATSIGHT_MULTILABEL_THRESHOLD", raising=False)
    importlib.reload(autolabel_service)


def test_build_prompt_multi_select_wording():
    label_defs = [{"name": "confused", "description": "student is confused"}]
    messages = [{"message_text": "I don't get it", "message_index": 0, "chatlog_id": 1}]
    single = autolabel_service.build_prompt(label_defs, {}, messages, multi_select=False)
    multi = autolabel_service.build_prompt(label_defs, {}, messages, multi_select=True)
    assert "each message" in single
    assert single != multi, "multi_select prompt must differ from single-select prompt"
    # Multi prompt must tell the model multiple/zero labels are allowed.
    assert "all that apply" in multi.lower() or "every label" in multi.lower()
    assert "none" in multi.lower() or "omit" in multi.lower(), (
        "multi prompt must state that zero labels (no match) is allowed"
    )


def test_classify_batch_uses_multi_config(monkeypatch):
    captured = {}

    class _FakeFn:
        name = "classify_messages"
        args = {"classifications": [{"index": 0, "label": "confused", "confidence": 0.9}]}

    class _FakePart:
        function_call = _FakeFn()

    class _FakeContent:
        parts = [_FakePart()]

    class _FakeCandidate:
        content = _FakeContent()

    class _FakeResp:
        candidates = [_FakeCandidate()]

    def fake_generate(model, contents, config):
        captured["config"] = config
        return _FakeResp()

    monkeypatch.setattr(autolabel_service.client.models, "generate_content", fake_generate)

    label_defs = [{"name": "confused", "description": ""}]
    messages = [{"message_text": "huh", "message_index": 0, "chatlog_id": 1}]

    autolabel_service.classify_batch(label_defs, {}, messages, multi_select=True)
    assert captured["config"] is autolabel_service.MULTI_SELECT_CONFIG

    autolabel_service.classify_batch(label_defs, {}, messages, multi_select=False)
    assert captured["config"] is autolabel_service.CONFIG


from sqlmodel import select
import main
import autolabel_service as _als
from models import LabelApplication, LabelDefinition, MessageCache


def _make_label(session, name):
    lbl = LabelDefinition(name=name, mode="multi", archived_at=None)
    session.add(lbl)
    session.commit()
    session.refresh(lbl)
    return lbl


def _seed_msg(session, chatlog_id, message_index, notebook, text):
    session.add(MessageCache(
        chatlog_id=chatlog_id,
        message_index=message_index,
        message_text=text,
        notebook=notebook,
    ))
    session.commit()


def test_run_autolabel_applies_multiple_labels_and_gates(session, engine, monkeypatch):
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(_als, "MULTILABEL_THRESHOLD", 0.5)

    a = _make_label(session, "label-a")
    b = _make_label(session, "label-b")
    c = _make_label(session, "label-c")
    _seed_msg(session, 1, 0, "lab01.ipynb", "msg one")
    _seed_msg(session, 2, 0, "lab01.ipynb", "msg two")

    multi_select_seen = {}

    def fake_classify(label_defs, examples_by_label, messages, multi_select=False):
        multi_select_seen["value"] = multi_select
        # message index 0 -> two labels above threshold + one below; index 1 -> none
        return [
            {"index": 0, "label": "label-a", "confidence": 0.9},
            {"index": 0, "label": "label-b", "confidence": 0.8},
            {"index": 0, "label": "label-c", "confidence": 0.2},  # below threshold
        ]

    monkeypatch.setattr(_als, "classify_batch", fake_classify)
    main._run_autolabel()

    assert multi_select_seen["value"] is True, "general autolabel must call with multi_select=True"

    ai_apps = session.exec(
        select(LabelApplication).where(LabelApplication.applied_by == "ai")
    ).all()
    by_label = {app.label_id for app in ai_apps}
    assert a.id in by_label, "label-a (0.9) should be applied"
    assert b.id in by_label, "label-b (0.8) should be applied"
    assert c.id not in by_label, "label-c (0.2) below threshold must NOT be applied"
    # Message index 1 got no entries -> stays unlabeled.
    assert all(app.chatlog_id == 1 for app in ai_apps), "only message 1 should be labeled"
    assert main._autolabel_status["error"] is None
