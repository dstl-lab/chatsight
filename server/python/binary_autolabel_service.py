"""Binary classifier using Gemini for the single-label workflow."""
import os
from typing import List, Dict, Any
from google import genai
from google.genai import types
from sqlmodel import Session, select
from models import LabelDefinition, LabelApplication, MessageCache

_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

_TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="classify_binary",
        description="Decide yes/no for each message against a single label.",
        parameters={
            "type": "object",
            "properties": {
                "classifications": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "index": {"type": "integer"},
                            "value": {"type": "string", "enum": ["yes", "no"]},
                            "confidence": {"type": "number"},
                        },
                        "required": ["index", "value", "confidence"],
                    },
                },
            },
            "required": ["classifications"],
        },
    )
])

_CONFIG = types.GenerateContentConfig(
    system_instruction=(
        "You are deciding, for a single label, whether each given student message "
        "fits the label or not. Reply yes/no with a 0..1 confidence."
    ),
    temperature=0,
    tools=[_TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["classify_binary"],
        )
    ),
)


def _build_prompt(label: Dict[str, Any], yes_examples: List[str], no_examples: List[str], messages: List[Dict[str, Any]]) -> str:
    parts = [f"## Label\n**{label['name']}**"]
    if label.get("description"):
        parts.append(label["description"])
    parts.append("")
    if yes_examples:
        parts.append("## Yes examples")
        for e in yes_examples[:10]:
            parts.append(f'- "{e[:300]}"')
    if no_examples:
        parts.append("## No examples")
        for e in no_examples[:10]:
            parts.append(f'- "{e[:300]}"')
    parts.append("\n## Messages to classify")
    for i, m in enumerate(messages):
        parts.append(f'{i}. "{m["message_text"][:500]}"')
    parts.append('\nCall `classify_binary` with index, value ("yes"|"no"), and confidence.')
    return "\n".join(parts)


def _call_gemini(prompt: str) -> List[Dict[str, Any]]:
    resp = _client.models.generate_content(
        model="gemini-2.0-flash", contents=prompt, config=_CONFIG
    )
    for part in resp.candidates[0].content.parts:
        if part.function_call and part.function_call.name == "classify_binary":
            args = dict(part.function_call.args)
            return list(args.get("classifications", []))
    return []


def classify_binary_batch(
    *, label: Dict[str, Any], yes_examples: List[str], no_examples: List[str], messages: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    prompt = _build_prompt(label, yes_examples, no_examples, messages)
    return _call_gemini(prompt)


def _few_shot(session: Session, label_id: int, value: str, k: int = 10) -> List[str]:
    rows = session.exec(
        select(LabelApplication, MessageCache)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.value == value,
            LabelApplication.applied_by == "human",
            LabelApplication.chatlog_id == MessageCache.chatlog_id,
            LabelApplication.message_index == MessageCache.message_index,
        )
        .order_by(LabelApplication.created_at.desc())
        .limit(k)
    ).all()
    return [m.message_text for _, m in rows]


def run_handoff(session: Session, *, label_id: int, batch_size: int = 50) -> int:
    """Run Gemini batch over still-unlabeled messages for this label.

    Returns the number of AI predictions written.
    """
    label = session.get(LabelDefinition, label_id)
    if label is None:
        raise ValueError(f"label {label_id} not found")

    yes_ex = _few_shot(session, label_id, "yes")
    no_ex = _few_shot(session, label_id, "no")

    decided_keys = set(
        (la.chatlog_id, la.message_index)
        for la in session.exec(
            select(LabelApplication).where(LabelApplication.label_id == label_id)
        ).all()
    )
    all_messages = session.exec(select(MessageCache).order_by(MessageCache.chatlog_id, MessageCache.message_index)).all()
    todo = [m for m in all_messages if (m.chatlog_id, m.message_index) not in decided_keys]

    written = 0
    label_dict = {"name": label.name, "description": label.description}

    for start in range(0, len(todo), batch_size):
        batch = todo[start:start + batch_size]
        msgs = [
            {"chatlog_id": m.chatlog_id, "message_index": m.message_index, "message_text": m.message_text}
            for m in batch
        ]
        results = classify_binary_batch(label=label_dict, yes_examples=yes_ex, no_examples=no_ex, messages=msgs)
        for r in results:
            i = r["index"]
            if i < 0 or i >= len(batch):
                continue
            m = batch[i]
            session.add(LabelApplication(
                label_id=label_id,
                chatlog_id=m.chatlog_id,
                message_index=m.message_index,
                value=r["value"],
                applied_by="ai",
                confidence=float(r.get("confidence", 0.0)),
            ))
            written += 1
        session.commit()

    label.phase = "handed_off"
    label.is_active = False
    session.add(label)
    session.commit()
    return written
