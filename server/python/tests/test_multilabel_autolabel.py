"""Tests for multi-label auto-labeling (multi_select + confidence threshold)."""
from datetime import datetime
from unittest.mock import patch

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
    # Restore default so later tests are not affected by the reloaded module.
    monkeypatch.delenv("CHATSIGHT_MULTILABEL_THRESHOLD", raising=False)
    importlib.reload(autolabel_service)
