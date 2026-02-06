from .models import Conversation, Message
from sqlmodel import SQLModel, create_engine, Session
import os

from configs import ROOT_DIR

sqlite_file_name = os.path.join(ROOT_DIR, "database", "dev.db")
sqlite_url = f"sqlite:///{sqlite_file_name}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def seed_db():
    with Session(engine) as session:
        convo = session.get(Conversation, 1)
        if not convo:
            convo = Conversation(id=1, title="Default Chat")
            session.add(convo)
            session.commit()

def get_session():
    with Session(engine) as session:
        yield session
