import os
from dotenv import load_dotenv
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import create_engine as sa_create_engine

load_dotenv()

DATABASE_URL = "sqlite:///./chatsight.db"
engine = create_engine(DATABASE_URL, echo=True)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session

_pg_password = os.environ["PG_PASSWORD"]
EXT_DB_URL = f"postgresql+psycopg2://dsc10_tutor:{_pg_password}@localhost:5433/dsc10_tutor_logs"
ext_engine = sa_create_engine(EXT_DB_URL)
