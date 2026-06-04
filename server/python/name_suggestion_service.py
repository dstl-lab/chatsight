import json
import os
from typing import List, Optional

import numpy as np
from google import genai
from google.genai import types as genai_types

SUGGESTION_SIMILARITY_THRESHOLD = 0.75
_EMBED_MODEL = "gemini-embedding-001"
_GENERATE_MODEL = "gemini-2.5-flash"

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

# Module-level cache so the on-demand generation only runs once per server session
_generated_cache: Optional[List[dict]] = None


def _cosine_sim(a: List[float], b: List[float]) -> float:
    va, vb = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0.0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def filter_suggestions(
    candidate_names: List[str],
    candidate_descriptions: List[str],
    existing_names: List[str],
) -> List[dict]:
    """Return candidates not semantically similar to any existing label name.

    Embeds all texts in one batch call: candidates first, then existing names.
    Drops any candidate whose max cosine similarity to an existing label
    exceeds SUGGESTION_SIMILARITY_THRESHOLD.
    """
    if not candidate_names:
        return []
    if not existing_names:
        return [
            {"name": n, "description": d}
            for n, d in zip(candidate_names, candidate_descriptions)
        ]

    all_texts = candidate_names + existing_names
    resp = client.models.embed_content(model=_EMBED_MODEL, contents=all_texts)
    embeddings = [e.values for e in resp.embeddings]

    cand_vecs = embeddings[: len(candidate_names)]
    exist_vecs = embeddings[len(candidate_names) :]

    result = []
    for name, desc, vec in zip(candidate_names, candidate_descriptions, cand_vecs):
        max_sim = max(_cosine_sim(vec, ex) for ex in exist_vecs)
        if max_sim <= SUGGESTION_SIMILARITY_THRESHOLD:
            result.append({"name": name, "description": desc})
    return result


def generate_from_messages(
    message_texts: List[str],
    existing_names: List[str],
) -> List[dict]:
    """Generate label name suggestions from a sample of messages.

    Asks Gemini to propose label concepts visible in the data, then filters
    them through cosine similarity to drop anything too close to existing labels.
    Result is cached in _generated_cache so subsequent calls skip the Gemini call.
    """
    global _generated_cache
    if _generated_cache is not None:
        # Re-filter cached suggestions against current existing labels in case new
        # labels were created since the cache was populated.
        if not existing_names:
            return _generated_cache
        try:
            return filter_suggestions(
                candidate_names=[s["name"] for s in _generated_cache],
                candidate_descriptions=[s["description"] for s in _generated_cache],
                existing_names=existing_names,
            )
        except Exception:
            return _generated_cache

    if not message_texts:
        return []

    existing_str = (
        ", ".join(f'"{n}"' for n in existing_names) if existing_names else "none yet"
    )
    sample = "\n".join(f"- {m[:200]}" for m in message_texts[:40])

    prompt = (
        "You are helping an instructor create labels for student-AI tutoring conversations.\n\n"
        f"Already-created labels (avoid these and close synonyms): {existing_str}\n\n"
        "Sample student messages from the dataset:\n"
        f"{sample}\n\n"
        "Suggest 8-12 concise label names capturing distinct student behaviors or intents "
        "visible in these messages. Return a JSON array only, no explanation:\n"
        '[{"name": "label name", "description": "one sentence description"}, ...]'
    )

    response = client.models.generate_content(
        model=_GENERATE_MODEL,
        contents=prompt,
        config=genai_types.GenerateContentConfig(temperature=0.3),
    )

    text = response.text.strip()
    if "```" in text:
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else parts[0]
        if text.startswith("json"):
            text = text[4:]

    raw: List[dict] = json.loads(text.strip())
    suggestions = [
        {"name": s["name"], "description": s.get("description", "")}
        for s in raw
        if isinstance(s, dict) and "name" in s
    ]

    # Cache the raw generated set before similarity filtering
    _generated_cache = suggestions

    if not existing_names or not suggestions:
        return suggestions

    try:
        return filter_suggestions(
            candidate_names=[s["name"] for s in suggestions],
            candidate_descriptions=[s["description"] for s in suggestions],
            existing_names=existing_names,
        )
    except Exception:
        return suggestions
