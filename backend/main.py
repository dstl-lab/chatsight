from contextlib import asynccontextmanager
from typing import List
from pydantic import BaseModel


from fastapi import Depends, FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from .database import create_db_and_tables, get_session, seed_db
from .models import Message, Conversation
from .llm import generate_llm_response

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

create_db_and_tables()
seed_db()

@app.get("/")
def root():
    return {"message": "Backend is running!"}

class ChatRequest(BaseModel):
    messages: List[Message]

@app.post("/conversations/", response_model=Conversation)
def create_conversation(
    conversation: Conversation, session: Session = Depends(get_session)
):
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return conversation


@app.get("/conversations/", response_model=List[Conversation])
def read_conversations(
    offset: int = 0, limit: int = 100, session: Session = Depends(get_session)
):
    conversations = session.exec(
        select(Conversation).offset(offset).limit(limit)
    ).all()
    return conversations


@app.get("/conversations/{conversation_id}", response_model=Conversation)
def read_conversation(
    conversation_id: int, session: Session = Depends(get_session)
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int, session: Session = Depends(get_session)
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    session.delete(conversation)
    session.commit()
    return {"ok": True}

@app.post("/conversations/{conversation_id}/messages", response_model=List[Message])
def create_message(
    conversation_id: int,
    message: Message = Body(...),  # <-- tell FastAPI to parse body
    session: Session = Depends(get_session),
):

    message.conversation_id = conversation_id
    session.add(message)
    session.commit()
    session.refresh(message)

    #get prev messages to feed into llm for response
    messages_in_db = session.exec(
        select(Message).where(Message.conversation_id == conversation_id)
    ).all()
    llm_messages = [
        {"role": msg.role, "content": msg.content} for msg in messages_in_db
    ]

    #call llm to generate response + add it to the history
    assistant_content = generate_llm_response(llm_messages)

    assistant_message = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=assistant_content,
    )
    session.add(assistant_message)
    session.commit()
    session.refresh(assistant_message)

    return [message, assistant_message]


@app.get("/conversations/{conversation_id}/messages", response_model=List[Message])
def read_messages(
    conversation_id: int,
    session: Session = Depends(get_session),
):
    return session.exec(
        select(Message).where(Message.conversation_id == conversation_id)
    ).all()



# #???
# @app.post("/chat")
# def chat(request: ChatRequest):
#     # request.messages is the list of all past messages
#     conversation_history = request.messages

#     # You can now feed conversation_history to your LLM
#     # For example, turn it into a prompt string
#     prompt = "Take into consideration the older messages, but directly answer the newest message"
#     for msg in conversation_history:
#         prompt += f"{msg.role}: {msg.content}\n"

#     # Here you would call your LLM with `prompt` and get a response
#     llm_response = generate_llm_response(prompt)
    
#     # Return the LLM response
#     return {"reply": llm_response}

# def save_messages(conversation_id: int, messages: list[Message]):
#     with Session(get_session()) as session:
#         for msg in messages:
#             session.add(msg)
#         session.commit()
