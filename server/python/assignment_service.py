"""Assignment mapping: regex on notebook filename → assignment name."""
import re
from typing import Optional

from sqlmodel import Session, select

from models import AssignmentMapping, MessageCache


# Pattern for grouping notebooks like "lab3.ipynb", "lab03.ipynb", "lab_3.ipynb" into "Lab 3".
_KIND_RE = re.compile(r"^(lab|project|proj|hw|homework)[ _-]?0?(\d+)", re.IGNORECASE)
_KIND_LABEL = {
    "lab": "Lab",
    "project": "Project",
    "proj": "Project",
    "hw": "Homework",
    "homework": "Homework",
}


def _stem(filename: str) -> str:
    return filename.rsplit(".", 1)[0] if "." in filename else filename


def _canonical_name(notebook: str) -> str:
    """Map a raw notebook filename to a canonical assignment name (heuristic)."""
    stem = _stem(notebook)
    m = _KIND_RE.match(stem)
    if m:
        kind = m.group(1).lower()
        num = m.group(2).lstrip("0") or "0"
        return f"{_KIND_LABEL[kind]} {num}"
    return stem


def infer_assignments_from_cache(session: Session) -> dict:
    """Read distinct notebooks already cached locally (read-only on external DB)
    and create AssignmentMapping rows by grouping similar names.

    Heuristic: 'lab3.ipynb', 'lab03.ipynb', 'lab_3.ipynb' all collapse to 'Lab 3'.
    Anything that doesn't match a known kind keeps its stem as the canonical name.

    Idempotent: existing mapping names are preserved unchanged.

    Returns: {created: int, total_notebooks: int, groups: [...]}"""
    raw = session.exec(
        select(MessageCache.notebook)
        .where(MessageCache.notebook != None)  # noqa: E711
    ).all()
    notebooks = sorted({n for n in raw if n})

    groups: dict[str, list[str]] = {}
    for nb in notebooks:
        canonical = _canonical_name(nb)
        groups.setdefault(canonical, []).append(nb)

    existing = {m.name for m in session.exec(select(AssignmentMapping)).all()}
    created = 0
    for canonical, notebook_list in groups.items():
        if canonical in existing:
            continue
        stems = [_stem(n) for n in notebook_list]
        if len(stems) == 1:
            pattern = f"^{re.escape(stems[0])}\\b"
        else:
            pattern = "^(" + "|".join(re.escape(s) for s in stems) + r")\b"
        session.add(AssignmentMapping(name=canonical, pattern=pattern))
        created += 1
    session.commit()

    if created:
        match_all_messages(session)

    return {
        "created": created,
        "total_notebooks": len(notebooks),
        "groups": [
            {"name": k, "notebooks": v, "count": len(v)} for k, v in sorted(groups.items())
        ],
    }


def match_all_messages(session: Session) -> int:
    """Re-tag every MessageCache row according to current AssignmentMapping rules.
    First match wins, ordered by mapping id ascending. Returns number of rows updated."""
    mappings = session.exec(
        select(AssignmentMapping).order_by(AssignmentMapping.id)
    ).all()
    if not mappings:
        # No mappings → clear all assignment_ids (instructor removed every mapping)
        rows = session.exec(
            select(MessageCache).where(MessageCache.assignment_id != None)  # noqa: E711
        ).all()
        for r in rows:
            r.assignment_id = None
            session.add(r)
        session.commit()
        return len(rows)

    compiled: list[tuple[int, re.Pattern]] = []
    for m in mappings:
        try:
            compiled.append((m.id, re.compile(m.pattern)))
        except re.error:
            continue

    rows = session.exec(select(MessageCache)).all()
    updated = 0
    for r in rows:
        new_id: Optional[int] = None
        if r.notebook:
            for mid, regex in compiled:
                if regex.search(r.notebook):
                    new_id = mid
                    break
        if r.assignment_id != new_id:
            r.assignment_id = new_id
            session.add(r)
            updated += 1
    session.commit()
    return updated


def clear_assignment(session: Session, assignment_id: int) -> int:
    """Clear `assignment_id` on every MessageCache row tagged with the given mapping."""
    rows = session.exec(
        select(MessageCache).where(MessageCache.assignment_id == assignment_id)
    ).all()
    for r in rows:
        r.assignment_id = None
        session.add(r)
    session.commit()
    return len(rows)


def merge_assignments(
    session: Session,
    source_ids: list[int],
    target_id: int,
    new_name: Optional[str] = None,
) -> dict:
    """Reassign all MessageCache rows tagged with `source_ids` to `target_id`,
    delete the source mappings, and union their regex patterns into the target so
    future re-tag passes preserve the merge.

    Returns: {merged: int, moved_messages: int, target_id: int}.
    """
    if target_id in source_ids:
        raise ValueError("target_id cannot appear in source_ids")
    target = session.get(AssignmentMapping, target_id)
    if not target:
        raise ValueError(f"target assignment {target_id} not found")
    sources = [session.get(AssignmentMapping, sid) for sid in source_ids]
    sources = [s for s in sources if s is not None]
    if not sources:
        raise ValueError("no valid source assignments")

    moved = 0
    for s in sources:
        rows = session.exec(
            select(MessageCache).where(MessageCache.assignment_id == s.id)
        ).all()
        for r in rows:
            r.assignment_id = target_id
            session.add(r)
            moved += 1

    # Union patterns so a later match_all_messages run won't unwind the merge.
    unique = list(dict.fromkeys([target.pattern] + [s.pattern for s in sources]))
    if len(unique) > 1:
        target.pattern = "(?:" + ")|(?:".join(unique) + ")"

    if new_name and new_name.strip():
        target.name = new_name.strip()

    session.add(target)
    merged_count = len(sources)
    for s in sources:
        session.delete(s)
    session.commit()
    return {"merged": merged_count, "moved_messages": moved, "target_id": target_id}


def message_count_per_assignment(session: Session) -> dict[Optional[int], int]:
    """Return {assignment_id: count} for all MessageCache rows. None key = unmapped."""
    rows = session.exec(select(MessageCache.assignment_id)).all()
    counts: dict[Optional[int], int] = {}
    for aid in rows:
        counts[aid] = counts.get(aid, 0) + 1
    return counts
