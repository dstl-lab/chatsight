import os
from google import genai
from google.genai import types
from typing import List

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])


def generate_label_definition(label_name: str, example_messages: List[str]) -> str:
    """
    Given a label name and a list of example student messages that carry that label,
    ask Gemini to produce a concise 1-2 sentence definition.
    """
    numbered = "\n".join(f"{i + 1}. {m}" for i, m in enumerate(example_messages))

    prompt = f"""You are helping an instructor document labels used in a student-AI tutoring chatlog labeling system for an undergraduate course.

Label name: "{label_name}"

The following student messages have been labeled "{label_name}" by human instructors:

{numbered}

Write a very concise 1 sentence definition of what "{label_name}" means in this labeling context. Be specific to the patterns you observe in the examples above. 
Return only the definition text, nothing else. Do not restate the name of the label in your definition.

An example is 'Responds to AI question or message'. It does not restate any of the label, and it immediately begins the defintion without stating anything about this label. It begins with a verb to be concise"""

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0),
    )
    return response.text.strip()


def select_best_example(label_name: str, description: str, example_messages: List[str]) -> str:
    """
    Given a label's description and a list of candidate human-labeled messages,
    return the single message that best exemplifies the description.
    """
    numbered = "\n".join(f"{i + 1}. {m}" for i, m in enumerate(example_messages))

    prompt = f"""You are helping an instructor review labels in a student-AI tutoring chatlog labeling system.

Label name: "{label_name}"
Description: {description}

The following student messages have been labeled "{label_name}" by human instructors:

{numbered}

Which single message best exemplifies the description above? It should be the message that most explicitly shows this description. If there are messages that are equally related the description, prioritize the shorter message. Reply with only the number of that message (e.g. "3"). Nothing else."""

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0),
    )
    raw = response.text.strip()
    try:
        idx = int(raw) - 1  # convert 1-based to 0-based
        if 0 <= idx < len(example_messages):
            return example_messages[idx]
    except ValueError:
        pass
    return example_messages[0]  # fallback to first if parse fails


def batch_process_recalibration(label_data: List[dict]) -> List[dict]:
    """
    Processes multiple labels in a single call to avoid hitting rate limits.
    Each item in label_data should be: {"name": str, "description": str, "examples": List[str]}
    Returns: List of {"label_name": str, "description": str, "example_text": str}
    """
    if not label_data:
        return []

    # Build a structured prompt for batch processing
    prompt_parts = [
        "You are an expert at summarizing and selecting representative examples for a chatlog labeling system.",
        "\nFor each of the following labels, provide:",
        "1. A concise 1-sentence definition (if not provided).",
        "2. The single best representative example from the provided list.",
        "\nReturn your answer as a JSON array of objects with keys: 'label_name', 'description', 'example_text'.",
        "\n## Labels to Process:\n"
    ]

    for item in label_data:
        desc = item.get("description") or "[To be generated]"
        exs = "\n".join(f"- {ex}" for ex in item["examples"][:10])
        prompt_parts.append(f"### Label: {item['name']}\nExisting Description: {desc}\nExamples:\n{exs}\n")

    prompt = "\n".join(prompt_parts)

    response = client.models.generate_content(
        model="gemini-3.1-flash-lite-preview",
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0,
            response_mime_type="application/json",
            response_schema={
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label_name": {"type": "string"},
                        "description": {"type": "string"},
                        "example_text": {"type": "string"}
                    },
                    "required": ["label_name", "description", "example_text"]
                }
            }
        ),
    )

    try:
        import json
        return json.loads(response.text)
    except Exception:
        # Fallback: if JSON fails, return existing data
        return [{"label_name": item["name"], "description": item.get("description") or "N/A", "example_text": item["examples"][0] if item["examples"] else None} for item in label_data]
