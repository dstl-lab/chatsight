"""Study fixture: hard-locked per-week assignment scopes for the user study.

`/queue` (multi-label) is locked to DSC 10 Winter-2026 Week 3 (Lab 1 + HW 1);
`/run` (single-label) is locked to Week 8 (Lab 5 + HW 5). Scope is expressed in
canonical assignment names (the same vocabulary as assignment_service) so it does
not depend on AssignmentMapping rows existing. Weeks come from
https://dsc-courses.github.io/dsc10-2026-wi/ (cross-checked vs
data/milestones/dsc10_wi26.json).
"""
import os
import threading
from typing import Optional

from sqlalchemy import func
from sqlmodel import Session, select

from assignment_service import _canonical_name
from models import MessageCache

# Memoized results keyed by (lock_on, frozenset(names), row_count).
# row_count keeps test suites isolated (each test seeds a different number of
# MessageCache rows) and picks up the rare case where the cache is filled after
# a partial startup. Thread-safe for concurrent FastAPI workers.
_scope_cache: dict = {}
_scope_cache_lock = threading.Lock()

QUEUE_SCOPE = {"Lab 1", "Homework 1"}   # Week 3 — multi-label
RUN_SCOPE = {"Lab 5", "Homework 5"}     # Week 8 — single-label


def lock_enabled() -> bool:
    """Whether the study week-lock is active. ON by default (production/study);
    set CHATSIGHT_STUDY_LOCK=0 to disable (legacy test suite seeds unscoped data).
    Read at call time so tests can toggle it via monkeypatch."""
    return os.getenv("CHATSIGHT_STUDY_LOCK", "1") != "0"


def scope_for_mode(mode: str) -> set[str]:
    """Single-label runs are Week 8; everything else (multi/onboarding) is Week 3."""
    return RUN_SCOPE if mode == "single" else QUEUE_SCOPE


def notebook_in_scope(notebook: Optional[str], names: set[str]) -> bool:
    if not lock_enabled():
        return True
    return notebook is not None and _canonical_name(notebook) in names


def in_scope_keys(session: Session, names: set[str]) -> set[tuple[int, int]]:
    """(chatlog_id, message_index) pairs whose notebook canonicalizes into `names`.
    When the lock is disabled, every cached message is considered in scope.

    Result is memoized in memory: the scope never changes within a server run,
    and the row_count fingerprint keeps test suites isolated across tests that
    seed different MessageCache data."""
    lock_on = lock_enabled()
    row_count = int(session.exec(select(func.count(MessageCache.id))).one())
    cache_key = (lock_on, frozenset(names), row_count)

    with _scope_cache_lock:
        cached = _scope_cache.get(cache_key)
        if cached is not None:
            return cached

    rows = session.exec(
        select(
            MessageCache.chatlog_id,
            MessageCache.message_index,
            MessageCache.notebook,
        )
    ).all()
    result = frozenset(
        (cid, midx)
        for cid, midx, nb in rows
        if notebook_in_scope(nb, names)
    )

    with _scope_cache_lock:
        _scope_cache[cache_key] = result

    return result
