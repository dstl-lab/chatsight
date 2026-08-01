import os
import shutil
from pathlib import Path
from dotenv import load_dotenv
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import create_engine as sa_create_engine, event

load_dotenv()

# Resolve to repo-root /database/chatsight.db regardless of cwd. Override with
# DATABASE_URL env var (e.g. for tests, alternate environments, or Docker).
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_DB_PATH = _REPO_ROOT / "database" / "chatsight.db"
_DEFAULT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _migrate_legacy_db_location():
    """One-time relocation: pre-2026-05 the SQLite DB lived at
    server/python/chatsight.db. If a collaborator pulls this commit with their
    old DB still in the legacy spot and the new spot is empty, move it so they
    don't see an apparently-empty UI."""
    legacy = _REPO_ROOT / "server" / "python" / "chatsight.db"
    if legacy.exists() and not _DEFAULT_DB_PATH.exists():
        for suffix in ("", "-shm", "-wal"):
            src = legacy.with_name(legacy.name + suffix)
            if src.exists():
                shutil.move(str(src), str(_DEFAULT_DB_PATH.with_name(_DEFAULT_DB_PATH.name + suffix)))
        print(f"[chatsight] migrated legacy DB: {legacy} -> {_DEFAULT_DB_PATH}")


_migrate_legacy_db_location()
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{_DEFAULT_DB_PATH}")
engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA busy_timeout=30000")
    cur.close()


def _migrate_label_definition(conn, inspect, text):
    cols = [c["name"] for c in inspect(conn).get_columns("labeldefinition")]
    if "sort_order" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"))
    if "archived_at" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN archived_at DATETIME"))
    if "mode" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN mode VARCHAR NOT NULL DEFAULT 'multi'"))
    if "phase" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN phase VARCHAR NOT NULL DEFAULT 'labeling'"))
    if "is_active" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 0"))
    if "queue_position" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN queue_position INTEGER"))
    if "summary_json" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN summary_json TEXT"))
    if "classified_count" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN classified_count INTEGER"))
    if "classification_total" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN classification_total INTEGER"))
    if "paired_label_id" not in cols:
        conn.execute(text(
            "ALTER TABLE labeldefinition ADD COLUMN paired_label_id INTEGER "
            "REFERENCES labeldefinition(id)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_labeldef_paired "
            "ON labeldefinition(paired_label_id)"
        ))
    if "batch_job_name" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN batch_job_name VARCHAR"))
    if "batch_state" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN batch_state VARCHAR"))
    if "batch_submitted_at" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN batch_submitted_at DATETIME"))
    if "batch_polled_at" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN batch_polled_at DATETIME"))
    if "batch_total_count" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN batch_total_count INTEGER"))
    if "batch_completed_count" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN batch_completed_count INTEGER"))
    if "review_threshold" not in cols:
        conn.execute(text(
            "ALTER TABLE labeldefinition ADD COLUMN review_threshold FLOAT NOT NULL DEFAULT 0.7"
        ))
    if "guidance" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN guidance TEXT"))
    if "hybrid_explore_fraction" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN hybrid_explore_fraction FLOAT"))
    if "onboarding_seed_chatlog_id" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN onboarding_seed_chatlog_id INTEGER"))
    if "onboarding_seed_message_index" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN onboarding_seed_message_index INTEGER"))
    if "handed_off_at" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN handed_off_at DATETIME"))
        _backfill_handed_off_at(conn, text)


def _backfill_handed_off_at(conn, text):
    """One-time: populate handed_off_at for already-handed-off single labels using
    the most-recent AI-applied row's created_at as a proxy for when the handoff
    ran, falling back to the label's own created_at when no AI rows exist. Only
    touches NULL rows in a handed-off phase, so it's safe to re-run."""
    conn.execute(text(
        """
        UPDATE labeldefinition
        SET handed_off_at = COALESCE(
            (SELECT MAX(la.created_at) FROM labelapplication la
             WHERE la.label_id = labeldefinition.id AND la.applied_by = 'ai'),
            created_at)
        WHERE mode = 'single'
          AND handed_off_at IS NULL
          AND phase IN ('classifying', 'handed_off', 'reviewing', 'complete', 'failed')
        """
    ))


def _migrate_onboarding_starter_cache(conn, inspect, text):
    if not inspect(conn).has_table("onboardingstartercache"):
        return
    cols = [c["name"] for c in inspect(conn).get_columns("onboardingstartercache")]
    if "preview_json" not in cols:
        conn.execute(text("ALTER TABLE onboardingstartercache ADD COLUMN preview_json TEXT"))


def _migrate_label_application(conn, inspect, text):
    cols = [c["name"] for c in inspect(conn).get_columns("labelapplication")]
    if "confidence" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN confidence FLOAT DEFAULT NULL"))
    if "value" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN value VARCHAR"))
    if "ai_value_at_review" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN ai_value_at_review VARCHAR DEFAULT NULL"))
    if "ai_confidence_at_review" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN ai_confidence_at_review FLOAT DEFAULT NULL"))
    if "matched_pattern" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN matched_pattern VARCHAR DEFAULT NULL"))
    if "rationale" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN rationale TEXT DEFAULT NULL"))
    if "flagged" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN flagged BOOLEAN NOT NULL DEFAULT 0"))
    if "note" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN note TEXT DEFAULT NULL"))


def _migrate_label_application_value_nullable(conn, inspect, text):
    """Pre-2026-05 the `value` column was created NOT NULL (DEFAULT 'yes') back
    when single-label decisions were the only writer. Multi-label applications
    insert value=NULL to distinguish themselves from single-label decisions, and
    the stale NOT NULL constraint rejects that — every POST /api/queue/apply 500s
    ("NOT NULL constraint failed: labelapplication.value"), so clicking a label
    and the 1-9 keybinds silently do nothing.

    SQLite can't DROP NOT NULL in place, so rebuild the table with `value`
    nullable (and restore the model's uq_labelapp_msg unique constraint while we
    have the table open). Idempotent: no-op once `value` is already nullable."""
    cols = {c["name"]: c for c in inspect(conn).get_columns("labelapplication")}
    # _migrate_label_application runs first and adds `value` (nullable) if missing.
    if "value" not in cols or cols["value"]["nullable"]:
        return
    conn.execute(text("ALTER TABLE labelapplication RENAME TO labelapplication_old"))
    conn.execute(text(
        "CREATE TABLE labelapplication ("
        " id INTEGER NOT NULL PRIMARY KEY,"
        " label_id INTEGER NOT NULL REFERENCES labeldefinition(id),"
        " chatlog_id INTEGER NOT NULL,"
        " message_index INTEGER NOT NULL,"
        " applied_by VARCHAR NOT NULL,"
        " confidence FLOAT,"
        " created_at DATETIME NOT NULL,"
        " value VARCHAR,"
        " ai_value_at_review VARCHAR,"
        " ai_confidence_at_review FLOAT,"
        " matched_pattern VARCHAR,"
        " rationale TEXT,"
        " flagged BOOLEAN NOT NULL DEFAULT 0,"
        " note TEXT,"
        " CONSTRAINT uq_labelapp_msg UNIQUE (label_id, chatlog_id, message_index)"
        ")"
    ))
    conn.execute(text(
        "INSERT INTO labelapplication"
        " (id, label_id, chatlog_id, message_index, applied_by, confidence,"
        "  created_at, value, ai_value_at_review, ai_confidence_at_review,"
        "  matched_pattern, rationale, flagged, note)"
        " SELECT id, label_id, chatlog_id, message_index, applied_by, confidence,"
        "  created_at, value, ai_value_at_review, ai_confidence_at_review,"
        "  matched_pattern, rationale, flagged, note"
        " FROM labelapplication_old"
    ))
    conn.execute(text("DROP TABLE labelapplication_old"))
    print("[chatsight] migrated labelapplication.value -> NULLable (multi-label apply fix)")


def _migrate_labeling_session(conn, inspect, text):
    cols = [c["name"] for c in inspect(conn).get_columns("labelingsession")]
    if "label_id" not in cols:
        conn.execute(text("ALTER TABLE labelingsession ADD COLUMN label_id INTEGER"))
    if "handed_off_at" not in cols:
        conn.execute(text("ALTER TABLE labelingsession ADD COLUMN handed_off_at DATETIME"))
    if "closed_at" not in cols:
        conn.execute(text("ALTER TABLE labelingsession ADD COLUMN closed_at DATETIME"))


def _migrate_message_cache(conn, inspect, text):
    cols = [c["name"] for c in inspect(conn).get_columns("messagecache")]
    if "notebook" not in cols:
        conn.execute(text("ALTER TABLE messagecache ADD COLUMN notebook VARCHAR"))
    if "assignment_id" not in cols:
        conn.execute(text("ALTER TABLE messagecache ADD COLUMN assignment_id INTEGER"))
    if "created_at" not in cols:
        conn.execute(text("ALTER TABLE messagecache ADD COLUMN created_at DATETIME"))
    if "context_before" not in cols:
        conn.execute(text("ALTER TABLE messagecache ADD COLUMN context_before TEXT"))
    if "context_after" not in cols:
        conn.execute(text("ALTER TABLE messagecache ADD COLUMN context_after TEXT"))


def _purge_archived_single_labels(conn, text):
    """Single-label abort/delete used to set archived_at instead of removing rows.
    Hard-delete is the only path now; purge legacy archived single labels on startup."""
    archived_ids = conn.execute(
        text("SELECT id FROM labeldefinition WHERE mode = 'single' AND archived_at IS NOT NULL")
    ).fetchall()
    if not archived_ids:
        return
    id_list = ",".join(str(row[0]) for row in archived_ids)
    for table in (
        "labelapplication",
        "labelprediction",
        "conversationcursor",
        "conversationprofile",
        "labelexploregradebook",
    ):
        conn.execute(text(f"DELETE FROM {table} WHERE label_id IN ({id_list})"))
    conn.execute(text(f"DELETE FROM labelingsession WHERE label_id IN ({id_list})"))
    conn.execute(
        text(f"UPDATE labeldefinition SET paired_label_id = NULL WHERE paired_label_id IN ({id_list})")
    )
    deleted = conn.execute(
        text("DELETE FROM labeldefinition WHERE mode = 'single' AND archived_at IS NOT NULL")
    )
    n = deleted.rowcount if deleted is not None else len(archived_ids)
    print(f"[chatsight] cleanup: removed {n} archived single-mode label(s) (legacy soft-delete)")


def _purge_archived_multi_labels(conn, text):
    """Multi-label archive was removed; purge legacy soft-archived rows on startup."""
    archived_ids = conn.execute(
        text("SELECT id FROM labeldefinition WHERE mode = 'multi' AND archived_at IS NOT NULL")
    ).fetchall()
    if not archived_ids:
        return
    id_list = ",".join(str(row[0]) for row in archived_ids)
    for table in ("labelapplication", "labelprediction"):
        conn.execute(text(f"DELETE FROM {table} WHERE label_id IN ({id_list})"))
    conn.execute(
        text(f"UPDATE labeldefinition SET paired_label_id = NULL WHERE paired_label_id IN ({id_list})")
    )
    deleted = conn.execute(
        text("DELETE FROM labeldefinition WHERE mode = 'multi' AND archived_at IS NOT NULL")
    )
    n = deleted.rowcount if deleted is not None else len(archived_ids)
    print(f"[chatsight] cleanup: removed {n} archived multi-mode label(s) (legacy soft-delete)")


def _cleanup_polluted_multi_label_rows(conn, text):
    """Pre-2026-05 an AI batch path wrote single-style decisions
    (value='yes'|'no'|'skip') against multi-mode labels. Those rows poison
    every multi-label count, exclusion, and aggregation. Idempotent: a clean
    DB is a no-op. Logs the row count it removed."""
    deleted = conn.execute(
        text(
            "DELETE FROM labelapplication "
            "WHERE value IS NOT NULL "
            "  AND label_id IN (SELECT id FROM labeldefinition WHERE mode = 'multi')"
        )
    )
    n = deleted.rowcount if deleted is not None else 0
    if n:
        print(f"[chatsight] cleanup: removed {n} stale value-bearing rows from multi-mode labels")


def _migrate_conversation_cursor(conn, inspect, text):
    cols = [c["name"] for c in inspect(conn).get_columns("conversationcursor")]
    if "last_message_index" not in cols:
        conn.execute(
            text(
                "ALTER TABLE conversationcursor "
                "ADD COLUMN last_message_index INTEGER NOT NULL DEFAULT 0"
            )
        )
    if "explore_pick_summary" not in cols:
        conn.execute(
            text("ALTER TABLE conversationcursor ADD COLUMN explore_pick_summary TEXT")
        )
    if "explore_pick_breakdown" not in cols:
        conn.execute(
            text("ALTER TABLE conversationcursor ADD COLUMN explore_pick_breakdown TEXT")
        )


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    with engine.connect() as conn:
        from sqlalchemy import text, inspect
        _migrate_label_definition(conn, inspect, text)
        _migrate_label_application(conn, inspect, text)
        _migrate_label_application_value_nullable(conn, inspect, text)
        _migrate_labeling_session(conn, inspect, text)
        _migrate_message_cache(conn, inspect, text)
        _migrate_conversation_cursor(conn, inspect, text)
        _migrate_onboarding_starter_cache(conn, inspect, text)
        _purge_archived_single_labels(conn, text)
        _purge_archived_multi_labels(conn, text)
        _cleanup_polluted_multi_label_rows(conn, text)
        # Indexes
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_labelapp_chatlog_msg "
            "ON labelapplication(chatlog_id, message_index)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_skipped_chatlog_msg "
            "ON skippedmessage(chatlog_id, message_index)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_labelapp_label_id "
            "ON labelapplication(label_id)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_msgcache_chatlog_msg "
            "ON messagecache(chatlog_id, message_index)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_labeldef_mode_phase "
            "ON labeldefinition(mode, phase)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_msgcache_assignment "
            "ON messagecache(assignment_id)"
        ))
        conn.commit()


def get_session():
    with Session(engine) as session:
        yield session


_pg_password = os.environ["PG_PASSWORD"]
EXT_DB_URL = os.environ["EXT_DB_URL"] if "EXT_DB_URL" in os.environ else f"postgresql+psycopg2://dsc10_tutor:{_pg_password}@localhost:5432/dsc10_tutor_logs"
ext_engine = sa_create_engine(EXT_DB_URL)
