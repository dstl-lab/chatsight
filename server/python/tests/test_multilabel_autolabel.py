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
