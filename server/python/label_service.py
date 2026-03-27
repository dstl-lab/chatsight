import os
from google import genai
from google.genai import types
from typing import List, Dict, Any

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="generate_labels",
        description="Generate structured labels for a student-AI chatlog",
        parameters={
            "type": "object",
            "properties": {
                "inferred_context": {"type": "string"},
                "labels": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "message_index": {"type": "integer"},
                            "label": {"type": "string"},
                            "evidence": {"type": "string"},
                            "rationale": {"type": "string"},
                            "granularity": {"type": "string", "enum": ["high", "mid", "low"]},
                        },
                        "required": ["message_index", "label", "evidence", "rationale", "granularity"],
                    },
                },
            },
            "required": ["inferred_context", "labels"],
        },
    )
])

GENERATE_CONFIG = types.GenerateContentConfig(
    system_instruction="You are an education researcher analyzing student-AI chatlogs. Your goal is to identify pedagogically meaningful patterns in how students interact with AI tutoring systems. Be precise, evidence-based, and consistent.",
    temperature=0,
    tools=[TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["generate_labels"],
        )
    ),
)


def generate_labels(content: str, steering_notes: str = "") -> List[Dict[str, Any]]:
    steering_block = f"\n## Steering Instructions\n{steering_notes}" if steering_notes else "\nUse your best judgment to identify key learning behaviors."

    user_message = f"""## Chatlog
{content}

## Step 1 – Context Inference
Identify: subject area, likely assignment, student understanding level.

## Step 2 – Label Each Interaction
For each student-AI interaction turn, identify:
- A short descriptive label (e.g. "Concept Probe", "Clarification Request", "Misconception", "Procedural Help")
- Evidence: a brief quote from the transcript
- Rationale: explanation of why this label applies
- Granularity: "high" (broad behavior), "mid" (specific skill), or "low" (surface-level detail)
{steering_block}

Call the `generate_labels` tool with a JSON array of label objects. Label every meaningful interaction turn (typically every 1-3 message pairs)."""

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=user_message,
        config=GENERATE_CONFIG,
    )

    for part in response.candidates[0].content.parts:
        if part.function_call and part.function_call.name == "generate_labels":
            args = dict(part.function_call.args)
            return list(args.get("labels", []))

    return []
