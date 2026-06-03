import os
from typing import List

import numpy as np
from google import genai

SUGGESTION_SIMILARITY_THRESHOLD = 0.75
_EMBED_MODEL = "gemini-embedding-001"

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))


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
