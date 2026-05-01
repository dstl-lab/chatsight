"""Tests for idempotent SQLite column-add migrations on schema evolution."""
from sqlalchemy import create_engine, text, inspect

from database import migrate_concept_candidate_columns


def _make_old_concept_candidate_table(engine):
    """Create a conceptcandidate table with only the legacy columns,
    matching the schema before the RAG-discovery rework."""
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE conceptcandidate (
                id INTEGER PRIMARY KEY,
                name TEXT,
                description TEXT,
                example_messages TEXT,
                status TEXT,
                source_run_id TEXT,
                similar_to TEXT,
                created_at TEXT
            )
        """))
        conn.commit()


def test_migration_adds_missing_columns(tmp_path):
    db_url = f"sqlite:///{tmp_path / 'old.db'}"
    engine = create_engine(db_url)
    _make_old_concept_candidate_table(engine)

    with engine.connect() as conn:
        migrate_concept_candidate_columns(conn)
        cols = [c["name"] for c in inspect(conn).get_columns("conceptcandidate")]

    for required in [
        "kind", "discovery_run_id", "shown_at", "decided_at",
        "decision", "created_label_id", "evidence_message_ids",
        "co_occurrence_label_ids", "co_occurrence_count",
    ]:
        assert required in cols, f"missing column: {required}"


def test_migration_is_idempotent(tmp_path):
    db_url = f"sqlite:///{tmp_path / 'fresh.db'}"
    engine = create_engine(db_url)
    _make_old_concept_candidate_table(engine)

    with engine.connect() as conn:
        migrate_concept_candidate_columns(conn)
        # Second call must not error or duplicate columns.
        migrate_concept_candidate_columns(conn)
        cols = [c["name"] for c in inspect(conn).get_columns("conceptcandidate")]

    # No duplicates expected; len == unique count.
    assert len(cols) == len(set(cols))
    assert "kind" in cols
