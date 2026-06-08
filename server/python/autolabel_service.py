"""Batch auto-labeling service using Gemini.

Given human-labeled examples and label definitions, classifies unlabeled
student messages into existing label categories.
"""
import logging
import os
import json
from google import genai
from google.genai import types
from typing import List, Dict, Any

log = logging.getLogger(__name__)

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

MULTILABEL_THRESHOLD = float(os.environ.get("CHATSIGHT_MULTILABEL_THRESHOLD", "0.5"))


class ClassifyToolMissing(RuntimeError):
    """Gemini did not return the classify_messages tool call.
    Distinct from network errors so callers can decide whether to retry,
    log+continue, or surface to the UI."""

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
                            "index": {"type": "integer", "description": "Index in the input messages array. The same index may appear in multiple entries when several labels apply."},
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

_SINGLE_SELECT_INSTRUCTION = (
    "You are classifying student messages from AI tutoring conversations. "
    "You will be given label definitions with example messages, then a batch "
    "of unlabeled messages to classify. Assign exactly one label to each message. "
    "Use the label names exactly as provided. Rate your confidence from 0.0 (very uncertain) to 1.0 (very certain)."
)

_MULTI_SELECT_INSTRUCTION = (
    "You are classifying student messages from AI tutoring conversations. "
    "You will be given label definitions with example messages, then a batch "
    "of unlabeled messages to classify. Assign EVERY label that applies to a "
    "message — a message may match several labels, exactly one, or none. Emit a "
    "SEPARATE classification entry for each applicable label, reusing the same "
    "index for every label that applies to that message. If a message matches no "
    "label, emit no entry for it. "
    "Use the label names exactly as provided. Rate your confidence from 0.0 (very uncertain) to 1.0 (very certain)."
)


def _make_config(system_instruction: str) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0,
        tools=[TOOL],
        tool_config=types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(
                mode="ANY",
                allowed_function_names=["classify_messages"],
            )
        ),
    )


CONFIG = _make_config(_SINGLE_SELECT_INSTRUCTION)            # default / split flow
MULTI_SELECT_CONFIG = _make_config(_MULTI_SELECT_INSTRUCTION)  # general auto-label


def build_prompt(
    label_definitions: List[Dict[str, Any]],
    examples_by_label: Dict[str, List[str]],
    messages: List[Dict[str, Any]],
    multi_select: bool = False,
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
    if multi_select:
        parts.append(
            "Call `classify_messages` with one entry per (message, applicable label). "
            "Assign all that apply: a message may get several labels, one, or none. "
            "Reuse the same index for each label that applies to that message; omit "
            "messages that match no label. Use label names exactly as defined above."
        )
    else:
        parts.append(
            "Call `classify_messages` with the index and label for each message. "
            "Use label names exactly as defined above."
        )
    return "\n".join(parts)


def classify_batch(
    label_definitions: List[Dict[str, Any]],
    examples_by_label: Dict[str, List[str]],
    messages: List[Dict[str, Any]],
    multi_select: bool = False,
) -> List[Dict[str, Any]]:
    """Classify a batch of messages. Returns list of {index, label, confidence}.

    When multi_select is True the model may return multiple entries per index
    (one per applicable label) or none; otherwise exactly one label per message.
    """
    prompt = build_prompt(label_definitions, examples_by_label, messages, multi_select)

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=MULTI_SELECT_CONFIG if multi_select else CONFIG,
    )

    if (
        not response.candidates
        or not response.candidates[0].content
        or not response.candidates[0].content.parts
    ):
        text_reply = getattr(response, "text", None)
        log.warning(
            "classify_batch: empty or blocked candidates; n_messages=%d text=%r",
            len(messages),
            (text_reply or "")[:200],
        )
        raise ClassifyToolMissing(
            f"Gemini returned no candidates (n={len(messages)})"
        )

    for part in response.candidates[0].content.parts:
        if part.function_call and part.function_call.name == "classify_messages":
            args = dict(part.function_call.args)
            return list(args.get("classifications", []))

    text_reply = getattr(response, "text", None)
    log.warning(
        "classify_batch: no tool call returned; n_messages=%d text=%r",
        len(messages),
        (text_reply or "")[:200],
    )
    raise ClassifyToolMissing(
        f"Gemini did not call classify_messages (n={len(messages)})"
    )

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
    
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=message_text,
        config=config,
    )
    return response.text.strip()
