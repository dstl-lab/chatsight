"""Single-label binary classification + post-handoff summary via Gemini."""
import json
import os
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

CLASSIFY_MODEL = "gemini-2.0-flash"

CLASSIFY_SYSTEM_INSTRUCTION = (
    "You are classifying student messages from AI-tutoring conversations as yes/no for "
    "ONE label at a time. The instructor has provided a label name, an optional description, "
    "and a few-shot block of human-decided examples (some yes, some no). Classify each new "
    "message accordingly. Confidence: 1.0 = certain, 0.5 = guess. Use the examples to "
    "calibrate borderline cases."
)

CLASSIFY_FUNCTION_DECLARATION = {
    "name": "classify_binary",
    "description": "Classify each student message as yes/no for the given label",
    "parameters": {
        "type": "object",
        "properties": {
            "classifications": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer", "description": "Index in the input messages array"},
                        "value": {"type": "string", "enum": ["yes", "no"]},
                        "confidence": {"type": "number", "description": "0.0 to 1.0"},
                    },
                    "required": ["index", "value", "confidence"],
                },
            },
        },
        "required": ["classifications"],
    },
}


# ─────────────────────────── Binary classifier ───────────────────────────

CLASSIFY_TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(**CLASSIFY_FUNCTION_DECLARATION)
])

CLASSIFY_CONFIG = types.GenerateContentConfig(
    system_instruction=CLASSIFY_SYSTEM_INSTRUCTION,
    temperature=0,
    tools=[CLASSIFY_TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["classify_binary"],
        )
    ),
)


def _build_classify_prompt(
    label_name: str,
    label_description: Optional[str],
    yes_examples: List[str],
    no_examples: List[str],
    messages: List[str],
) -> str:
    parts = [f"# Label: {label_name}"]
    if label_description:
        parts.append(f"\nDescription: {label_description}")
    if yes_examples:
        parts.append("\n## YES examples (label applies):")
        for ex in yes_examples[:10]:
            parts.append(f"- {ex}")
    if no_examples:
        parts.append("\n## NO examples (label does not apply):")
        for ex in no_examples[:10]:
            parts.append(f"- {ex}")
    parts.append("\n## Messages to classify (return one classification per index):")
    for i, m in enumerate(messages):
        parts.append(f"[{i}] {m}")
    return "\n".join(parts)


def classify_binary(
    label_name: str,
    label_description: Optional[str],
    yes_examples: List[str],
    no_examples: List[str],
    messages: List[str],
) -> List[Dict[str, Any]]:
    """Classify each message yes/no for the given label.

    Returns a list of `{index, value, confidence}` dicts in the same order as messages.
    Missing indices are filled in as `value="no", confidence=0.5`.
    """
    if not messages:
        return []
    prompt = _build_classify_prompt(label_name, label_description, yes_examples, no_examples, messages)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=CLASSIFY_CONFIG,
    )
    classifications: List[Dict[str, Any]] = []
    for part in response.candidates[0].content.parts:
        if part.function_call and part.function_call.name == "classify_binary":
            args = part.function_call.args or {}
            classifications = list(args.get("classifications", []))
            break

    by_index = {int(c["index"]): c for c in classifications if "index" in c}
    out: List[Dict[str, Any]] = []
    for i, _ in enumerate(messages):
        c = by_index.get(i)
        if c:
            out.append({
                "index": i,
                "value": c.get("value", "no"),
                "confidence": float(c.get("confidence", 0.5)),
            })
        else:
            out.append({"index": i, "value": "no", "confidence": 0.5})
    return out


# ─────────────────────────── Summary generator ───────────────────────────

SUMMARY_TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="report_patterns",
        description="Report inclusion/exclusion patterns observed during binary classification",
        parameters={
            "type": "object",
            "properties": {
                "included": {
                    "type": "array",
                    "description": "Patterns Gemini classified as YES",
                    "items": {
                        "type": "object",
                        "properties": {
                            "excerpt": {"type": "string", "description": "Short, quotable snippet (5-30 chars)"},
                            "frequency": {"type": "string", "description": "common | moderate | rare"},
                            "confidence_avg": {"type": "number"},
                        },
                        "required": ["excerpt", "frequency", "confidence_avg"],
                    },
                },
                "excluded": {
                    "type": "array",
                    "description": "Patterns Gemini classified as NO",
                    "items": {
                        "type": "object",
                        "properties": {
                            "excerpt": {"type": "string"},
                            "frequency": {"type": "string"},
                            "confidence_avg": {"type": "number"},
                        },
                        "required": ["excerpt", "frequency", "confidence_avg"],
                    },
                },
            },
            "required": ["included", "excluded"],
        },
    )
])

SUMMARY_CONFIG = types.GenerateContentConfig(
    system_instruction=(
        "You are summarising what an AI binary-classifier just did. Given a label name, "
        "description, and lists of messages it labeled YES vs NO, identify 3-5 short "
        "inclusion patterns (typical YES) and 3-5 short exclusion patterns (typical NO) "
        "as quotable excerpts. Excerpts should be very short (5-30 characters) and "
        "evocative — e.g., \"i'm stuck\", \"why questions\", \"error tracebacks\". "
        "Frequency is 'common', 'moderate', or 'rare' relative to the batch."
    ),
    temperature=0.3,
    tools=[SUMMARY_TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["report_patterns"],
        )
    ),
)


def summarize_batch(
    label_name: str,
    label_description: Optional[str],
    yes_messages: List[str],
    no_messages: List[str],
) -> Dict[str, Any]:
    """Return `{included: [...], excluded: [...]}` patterns describing the batch."""
    if not yes_messages and not no_messages:
        return {"included": [], "excluded": []}

    parts = [f"Label: {label_name}"]
    if label_description:
        parts.append(f"Description: {label_description}")
    parts.append(f"\nYES count: {len(yes_messages)}")
    parts.append(f"NO count: {len(no_messages)}")
    if yes_messages:
        parts.append("\nSample YES messages:")
        for m in yes_messages[:30]:
            parts.append(f"- {m}")
    if no_messages:
        parts.append("\nSample NO messages:")
        for m in no_messages[:30]:
            parts.append(f"- {m}")

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents="\n".join(parts),
        config=SUMMARY_CONFIG,
    )
    for part in response.candidates[0].content.parts:
        if part.function_call and part.function_call.name == "report_patterns":
            args = part.function_call.args or {}
            return {
                "included": list(args.get("included", [])),
                "excluded": list(args.get("excluded", [])),
            }
    return {"included": [], "excluded": []}


# ─────────────────────────── Batch API helpers ───────────────────────────

def build_classify_batch_request(
    key: str,
    label_name: str,
    label_description: Optional[str],
    yes_examples: List[str],
    no_examples: List[str],
    messages: List[str],
) -> Dict[str, Any]:
    """Return one entry for the Batch API JSONL, mirroring the sync `classify_binary`
    prompt + tool config. The `request` shape follows GenerateContentRequest in
    camelCase (Batch JSONL hits the REST API directly)."""
    prompt = _build_classify_prompt(
        label_name, label_description, yes_examples, no_examples, messages
    )
    return {
        "key": key,
        "request": {
            "contents": [{"parts": [{"text": prompt}]}],
            "systemInstruction": {"parts": [{"text": CLASSIFY_SYSTEM_INSTRUCTION}]},
            "generationConfig": {"temperature": 0},
            "tools": [{"functionDeclarations": [CLASSIFY_FUNCTION_DECLARATION]}],
            "toolConfig": {
                "functionCallingConfig": {
                    "mode": "ANY",
                    "allowedFunctionNames": ["classify_binary"],
                }
            },
        },
    }


def parse_classify_batch_response(
    response_obj: Optional[Dict[str, Any]],
    num_messages: int,
) -> List[Dict[str, Any]]:
    """Parse one line of the Batch API result JSONL into the same `{index, value,
    confidence}[]` shape as `classify_binary`. Missing/failed entries default to
    `value="no", confidence=0.5`."""
    classifications: List[Dict[str, Any]] = []
    try:
        parts = (response_obj or {}).get("candidates", [{}])[0].get("content", {}).get("parts", [])
        for part in parts:
            fc = part.get("functionCall")
            if fc and fc.get("name") == "classify_binary":
                args = fc.get("args", {}) or {}
                classifications = list(args.get("classifications", []))
                break
    except (IndexError, KeyError, TypeError, AttributeError):
        classifications = []

    by_index = {int(c["index"]): c for c in classifications if "index" in c}
    out: List[Dict[str, Any]] = []
    for i in range(num_messages):
        c = by_index.get(i)
        if c:
            out.append({
                "index": i,
                "value": c.get("value", "no"),
                "confidence": float(c.get("confidence", 0.5)),
            })
        else:
            out.append({"index": i, "value": "no", "confidence": 0.5})
    return out
