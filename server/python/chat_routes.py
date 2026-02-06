from contextlib import asynccontextmanager
from typing import List, Dict
from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlmodel import Session, select

from chat.database import create_db_and_tables, get_session, seed_db
from chat.models import Message, Conversation
from chat.llm import generate_llm_response

router = APIRouter(tags=["chat"])

@router.get("/api/files")
def list_files():
    return []

class ChatRequest(BaseModel):
    messages: List[Message]

@router.post("/conversations/", response_model=Conversation)
def create_conversation(
    conversation: Conversation, session: Session = Depends(get_session)
):
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return conversation


@router.get("/conversations/", response_model=List[Conversation])
def read_conversations(
    offset: int = 0, limit: int = 100, session: Session = Depends(get_session)
):
    conversations = session.exec(
        select(Conversation).offset(offset).limit(limit)
    ).all()
    return conversations


@router.get("/conversations/{conversation_id}", response_model=Conversation)
def read_conversation(
    conversation_id: int, session: Session = Depends(get_session)
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int, session: Session = Depends(get_session)
):
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    session.delete(conversation)
    session.commit()
    return {"ok": True}

@router.post("/conversations/{conversation_id}/messages", response_model=List[Message])
def create_message(
    conversation_id: int,
    message: Dict = Body(...),
    session: Session = Depends(get_session),
):
    # Get existing messages FIRST
    existing_messages = session.exec(
        select(Message).where(Message.conversation_id == conversation_id)
    ).all()
    
    # Build LLM messages
    llm_messages = [
        {"role": msg.role, "content": msg.content} for msg in existing_messages
    ]
    llm_messages.append({"role": message["role"], "content": message["content"]})

    # Create and save user message
    db_message = Message(
        conversation_id=conversation_id,
        role=message["role"],
        content=message["content"],
    )
    session.add(db_message)
    session.commit()
    session.refresh(db_message)

    # DEBUG: Check if db_message has proper values
    print(f"DEBUG db_message: ID={db_message.id}, role={db_message.role}, content={db_message.content[:30]}")

    # Generate assistant response
    assistant_content = generate_llm_response(llm_messages)

    # Save assistant message
    assistant_message = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=assistant_content,
    )
    session.add(assistant_message)
    session.commit()
    session.refresh(assistant_message)

    # DEBUG: Check what we're returning
    print(f"DEBUG assistant_message: ID={assistant_message.id}, role={assistant_message.role}, content={assistant_message.content[:30]}")
    print(f"Returning: [{db_message.id}, {assistant_message.id}]")

    return [db_message, assistant_message]

# @router.post("/conversations/{conversation_id}/messages", response_model=List[Message])
# def create_message(
#     conversation_id: int,
#     message: Dict = Body(...),  # Dict, not Message
#     session: Session = Depends(get_session),
# ):
#     # Get existing messages FIRST
#     existing_messages = session.exec(
#         select(Message).where(Message.conversation_id == conversation_id)
#     ).all()
    
#     # Build LLM messages
#     llm_messages = [
#         {"role": msg.role, "content": msg.content} for msg in existing_messages
#     ]
#     llm_messages.append({"role": message["role"], "content": message["content"]})

#     # Create and save user message
#     db_message = Message(
#         conversation_id=conversation_id,
#         role=message["role"],
#         content=message["content"],
#     )
#     session.add(db_message)
#     session.commit()
#     session.refresh(db_message)

#     # Generate assistant response
#     assistant_content = generate_llm_response(llm_messages)

#     # Save assistant message
#     assistant_message = Message(
#         conversation_id=conversation_id,
#         role="assistant",
#         content=assistant_content,
#     )
#     session.add(assistant_message)
#     session.commit()
#     session.refresh(assistant_message)

#     return [db_message, assistant_message]  # ← NOT [message, assistant_message]!


@router.get("/conversations/{conversation_id}/messages", response_model=List[Message])
def read_messages(
    conversation_id: int,
    session: Session = Depends(get_session),
):
    return session.exec(
        select(Message).where(Message.conversation_id == conversation_id)
    ).all()