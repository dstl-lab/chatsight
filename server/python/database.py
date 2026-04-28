import os
from dotenv import load_dotenv
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import create_engine as sa_create_engine

load_dotenv()

DATABASE_URL = os.environ.get("LOCAL_DB_URL", "sqlite:///./chatsight.db")
engine = create_engine(DATABASE_URL, echo=False)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    # Migrate: add sort_order column if missing (added in task4 branch)
    with engine.connect() as conn:
        from sqlalchemy import text, inspect
        cols = [c["name"] for c in inspect(conn).get_columns("labeldefinition")]
        if "sort_order" not in cols:
            conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
        # Migrate: add archived_at column if missing
        if "archived_at" not in cols:
            conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN archived_at DATETIME"))
            conn.commit()
        if "phase" not in cols:
            conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN phase TEXT NOT NULL DEFAULT 'labeling'"))
            conn.commit()
        if "is_active" not in cols:
            conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
        # Migrate: add confidence column if missing
        cols_la = [c["name"] for c in inspect(conn).get_columns("labelapplication")]
        if "confidence" not in cols_la:
            conn.execute(text("ALTER TABLE labelapplication ADD COLUMN confidence FLOAT DEFAULT NULL"))
            conn.commit()
        if "value" not in cols_la:
            conn.execute(text("ALTER TABLE labelapplication ADD COLUMN value TEXT NOT NULL DEFAULT 'yes'"))
            conn.commit()
        # Note: the unique constraint applies on fresh DBs only; existing rows on `main` are not migrated (separate DB file).
        # Add indexes for fast lookups on (chatlog_id, message_index)
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
        conn.commit()
        cols_ls = [c["name"] for c in inspect(conn).get_columns("labelingsession")]
        if "label_id" not in cols_ls:
            conn.execute(text("ALTER TABLE labelingsession ADD COLUMN label_id INTEGER"))
            conn.commit()
        if "handed_off_at" not in cols_ls:
            conn.execute(text("ALTER TABLE labelingsession ADD COLUMN handed_off_at DATETIME"))
            conn.commit()
        if "closed_at" not in cols_ls:
            conn.execute(text("ALTER TABLE labelingsession ADD COLUMN closed_at DATETIME"))
            conn.commit()

def get_session():
    with Session(engine) as session:
        yield session

_pg_password = os.environ["PG_PASSWORD"]
EXT_DB_URL = os.environ["EXT_DB_URL"] if "EXT_DB_URL" in os.environ else f"postgresql+psycopg2://dsc10_tutor:{_pg_password}@localhost:5432/dsc10_tutor_logs"
ext_engine = sa_create_engine(EXT_DB_URL)
