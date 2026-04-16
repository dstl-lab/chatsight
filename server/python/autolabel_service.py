"""Batch auto-labeling service using Gemini.

Given human-labeled examples and label definitions, classifies unlabeled
student messages into existing label categories.
"""
import os
import json
from google import genai
from google.genai import types
from typing import List, Dict, Any

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="classify_messages",
        description="Classify student messages into label categories",
        parameters={
            "type": "object",
            "properties": {
                "classifications": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "index": {"type": "integer", "description": "Index in the input messages array"},
                            "label": {"type": "string", "description": "The label name to assign"},
                            "confidence": {"type": "number", "description": "Your confidence in this classification, 0.0 to 1.0"},
                        },
                        "required": ["index", "label", "confidence"],
                    },
                },
            },
            "required": ["classifications"],
        },
    )
])

CONFIG = types.GenerateContentConfig(
    system_instruction=(
        "You are classifying student messages from AI tutoring conversations. "
        "You will be given label definitions with example messages, then a batch "
        "of unlabeled messages to classify. Assign exactly one label to each message. "
        "Use the label names exactly as provided. Rate your confidence from 0.0 (very uncertain) to 1.0 (very certain)."
    ),
    temperature=0,
    tools=[TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["classify_messages"],
        )
    ),
)


def build_prompt(
    label_definitions: List[Dict[str, Any]],
    examples_by_label: Dict[str, List[str]],
    messages: List[Dict[str, Any]],
) -> str:
    """Build the classification prompt with definitions, examples, and messages."""
    parts = ["## Label Definitions\n"]
    for ld in label_definitions:
        desc = f" — {ld['description']}" if ld.get("description") else ""
        parts.append(f"- **{ld['name']}**{desc}")
        exs = examples_by_label.get(ld["name"], [])
        for ex in exs[:5]:  # max 5 examples per label
            parts.append(f'  - Example: "{ex[:200]}"')
    parts.append("")

    parts.append("## Messages to Classify\n")
    for i, msg in enumerate(messages):
        ctx = ""
        if msg.get("context_before"):
            ctx += f" [preceding AI: ...{msg['context_before'][-100:]}]"
        parts.append(f"{i}. \"{msg['message_text']}\"{ctx}")
    parts.append("")
    parts.append(
        "Call `classify_messages` with the index and label for each message. "
        "Use label names exactly as defined above."
    )
    return "\n".join(parts)


def classify_batch(
    label_definitions: List[Dict[str, Any]],
    examples_by_label: Dict[str, List[str]],
    messages: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Classify a batch of messages. Returns list of {index, label}."""
    prompt = build_prompt(label_definitions, examples_by_label, messages)

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=CONFIG,
    )

    for part in response.candidates[0].content.parts:
        if part.function_call and part.function_call.name == "classify_messages":
            args = dict(part.function_call.args)
            return list(args.get("classifications", []))

    return []

def summarize_message(message_text: str) -> str:
    """Summarize a student message to be concise."""
    if not message_text.strip():
        return ""
    
    config = types.GenerateContentConfig(
        system_instruction=(
            "You are an expert at simplifying and summarizing student messages in AI tutoring chatlogs. "
            "Rewrite the following message to be very concise and clear, maintaining the core intent and context. "
            "Return ONLY the concise text, nothing else. Max 2 sentences."
        ),
        temperature=0,
    )
    
    try:
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=message_text,
            config=config,
        )
        return response.text.strip()
    except Exception as e:
        return f"Error summarizing: {e}"
