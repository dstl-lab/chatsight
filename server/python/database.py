import os
from dotenv import load_dotenv
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import create_engine as sa_create_engine

load_dotenv()

DATABASE_URL = "sqlite:///./chatsight.db"
engine = create_engine(DATABASE_URL, echo=False)


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


def _migrate_label_application(conn, inspect, text):
    cols = [c["name"] for c in inspect(conn).get_columns("labelapplication")]
    if "confidence" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN confidence FLOAT DEFAULT NULL"))
    if "value" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN value VARCHAR"))


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


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    with engine.connect() as conn:
        from sqlalchemy import text, inspect
        _migrate_label_definition(conn, inspect, text)
        _migrate_label_application(conn, inspect, text)
        _migrate_labeling_session(conn, inspect, text)
        _migrate_message_cache(conn, inspect, text)
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
