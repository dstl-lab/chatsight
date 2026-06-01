"""Study fixture: hard-locked per-week assignment scopes for the user study.

`/queue` (multi-label) is locked to DSC 10 Winter-2026 Week 3 (Lab 1 + HW 1);
`/run` (single-label) is locked to Week 8 (Lab 5 + HW 5). Scope is expressed in
canonical assignment names (the same vocabulary as assignment_service) so it does
not depend on AssignmentMapping rows existing. Weeks come from
https://dsc-courses.github.io/dsc10-2026-wi/ (cross-checked vs
data/milestones/dsc10_wi26.json).
"""
from typing import Optional

from sqlmodel import Session, select

from assignment_service import _canonical_name
from models import MessageCache

QUEUE_SCOPE = {"Lab 1", "Homework 1"}   # Week 3 — multi-label
RUN_SCOPE = {"Lab 5", "Homework 5"}     # Week 8 — single-label


def scope_for_mode(mode: str) -> set[str]:
    """Single-label runs are Week 8; everything else (multi/onboarding) is Week 3."""
    return RUN_SCOPE if mode == "single" else QUEUE_SCOPE


def notebook_in_scope(notebook: Optional[str], names: set[str]) -> bool:
    return notebook is not None and _canonical_name(notebook) in names


def in_scope_keys(session: Session, names: set[str]) -> set[tuple[int, int]]:
    """(chatlog_id, message_index) pairs whose notebook canonicalizes into `names`."""
    rows = session.exec(
        select(
            MessageCache.chatlog_id,
            MessageCache.message_index,
            MessageCache.notebook,
        )
    ).all()
    return {
        (cid, midx)
        for cid, midx, nb in rows
        if notebook_in_scope(nb, names)
    }
