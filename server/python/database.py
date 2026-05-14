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
    if "hybrid_explore_fraction" not in cols:
        conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN hybrid_explore_fraction FLOAT"))
    if "paired_label_id" not in cols:
        conn.execute(text(
            "ALTER TABLE labeldefinition ADD COLUMN paired_label_id INTEGER "
            "REFERENCES labeldefinition(id)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_labeldef_paired "
            "ON labeldefinition(paired_label_id)"
        ))


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
    if "last_message_index_decided" not in cols:
        conn.execute(
            text(
                "ALTER TABLE conversationcursor "
                "ADD COLUMN last_message_index_decided INTEGER NOT NULL DEFAULT 0"
            )
        )
    if "updated_at" not in cols:
        conn.execute(text("ALTER TABLE conversationcursor ADD COLUMN updated_at DATETIME"))


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    with engine.connect() as conn:
        from sqlalchemy import text, inspect
        _migrate_label_definition(conn, inspect, text)
        _migrate_label_application(conn, inspect, text)
        _migrate_labeling_session(conn, inspect, text)
        _migrate_message_cache(conn, inspect, text)
        _migrate_conversation_cursor(conn, inspect, text)
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
