import os
import uuid
import json
import numpy as np
from typing import List, Dict, Any
from google import genai
from google.genai import types
from sqlmodel import Session, select
from sklearn.cluster import KMeans

from models import MessageEmbedding, ConceptCandidate, LabelDefinition

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

EMBED_MODEL = "gemini-embedding-001"
EMBED_DIM = 3072
EMBED_BATCH_SIZE = 100  # Gemini API limit per call


def embed_messages(
    messages: List[Dict[str, Any]], db: Session
) -> np.ndarray:
    """Embed messages, using cached embeddings where available.

    Each message dict must have: chatlog_id, message_index, message_text.
    Returns numpy array of shape (len(messages), 768).
    """
    vectors = np.zeros((len(messages), EMBED_DIM), dtype=np.float32)
    uncached_indices: List[int] = []

    # Check cache
    for i, msg in enumerate(messages):
        cached = db.exec(
            select(MessageEmbedding).where(
                MessageEmbedding.chatlog_id == msg["chatlog_id"],
                MessageEmbedding.message_index == msg["message_index"],
                MessageEmbedding.model_version == EMBED_MODEL,
            )
        ).first()
        if cached:
            vectors[i] = np.frombuffer(cached.embedding, dtype=np.float32)
        else:
            uncached_indices.append(i)

    if not uncached_indices:
        return vectors

    # Embed uncached in batches
    for batch_start in range(0, len(uncached_indices), EMBED_BATCH_SIZE):
        batch_idx = uncached_indices[batch_start : batch_start + EMBED_BATCH_SIZE]
        texts = [messages[i]["message_text"] for i in batch_idx]

        result = client.models.embed_content(
            model=EMBED_MODEL,
            contents=texts,
        )

        for j, idx in enumerate(batch_idx):
            vec = np.array(result.embeddings[j].values, dtype=np.float32)
            vectors[idx] = vec
            # Cache
            row = MessageEmbedding(
                chatlog_id=messages[idx]["chatlog_id"],
                message_index=messages[idx]["message_index"],
                embedding=vec.tobytes(),
                model_version=EMBED_MODEL,
            )
            db.add(row)

    db.commit()
    return vectors


# ── Gemini concept suggestion tool ────────────────────────────────

SUGGEST_TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="suggest_concepts",
        description="Suggest new label categories for unlabeled student messages",
        parameters={
            "type": "object",
            "properties": {
                "concepts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "Short label name"},
                            "description": {"type": "string", "description": "1-2 sentence definition"},
                            "evidence": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "2-3 representative message excerpts",
                            },
                            "cluster_ids": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "Which cluster indices this concept spans",
                            },
                        },
                        "required": ["name", "description", "evidence", "cluster_ids"],
                    },
                },
            },
            "required": ["concepts"],
        },
    )
])

SUGGEST_CONFIG = types.GenerateContentConfig(
    system_instruction=(
        "You are an education researcher analyzing student-AI tutoring conversations. "
        "You are given groups of similar student messages that have NOT been labeled yet. "
        "Your job is to propose new label categories that capture pedagogically meaningful patterns. "
        "Only propose categories that are genuinely distinct from the existing labels provided. "
        "Be precise and evidence-based."
    ),
    temperature=0,
    tools=[SUGGEST_TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["suggest_concepts"],
        )
    ),
)


def _build_discovery_prompt(
    samples_by_cluster: Dict[int, List[Dict[str, Any]]],
    existing_labels: List[str],
    rejected_names: List[str],
) -> str:
    """Build the prompt for Gemini concept discovery."""
    parts = []

    parts.append("## Existing Labels (already in use — do NOT re-suggest these)")
    for name in existing_labels:
        parts.append(f"- {name}")

    if rejected_names:
        parts.append("\n## Previously Rejected (do NOT suggest these again)")
        for name in rejected_names:
            parts.append(f"- {name}")

    parts.append("\n## Unlabeled Message Clusters")
    parts.append("Each cluster contains similar messages that don't fit existing labels.\n")

    for cluster_id, samples in samples_by_cluster.items():
        parts.append(f"### Cluster {cluster_id}")
        for s in samples:
            text = s["message_text"][:300]
            parts.append(f'- "{text}"')
        parts.append("")

    parts.append(
        "## Task\n"
        "Analyze these clusters and propose new label categories. Each category should:\n"
        "- Have a short, descriptive name\n"
        "- Be pedagogically meaningful (describes a learning behavior or interaction pattern)\n"
        "- Be distinct from existing labels\n"
        "- Reference specific message excerpts as evidence\n\n"
        "Call the `suggest_concepts` tool with your proposed categories."
    )

    return "\n".join(parts)


def discover_concepts(
    messages: List[Dict[str, Any]],
    db: Session,
    n_clusters: int = 8,
    sample_per_cluster: int = 5,
) -> List[ConceptCandidate]:
    """Embed, cluster, sample, and ask Gemini to propose new label categories.

    Each message dict must have: chatlog_id, message_index, message_text.
    Returns list of ConceptCandidate rows (already saved to DB).
    """
    if len(messages) < 5:
        return []

    # 1. Embed
    vectors = embed_messages(messages, db)

    # 2. Cluster
    k = min(n_clusters, len(messages) // 5)
    k = max(k, 2)
    kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = kmeans.fit_predict(vectors)

    # 3. Sample nearest-to-centroid from each cluster
    samples_by_cluster: Dict[int, List[Dict[str, Any]]] = {}
    for cluster_id in range(k):
        mask = labels == cluster_id
        if not mask.any():
            continue
        cluster_vectors = vectors[mask]
        cluster_messages = [messages[i] for i in range(len(messages)) if labels[i] == cluster_id]
        centroid = kmeans.cluster_centers_[cluster_id]
        distances = np.linalg.norm(cluster_vectors - centroid, axis=1)
        nearest_idx = np.argsort(distances)[:sample_per_cluster]
        samples_by_cluster[cluster_id] = [cluster_messages[i] for i in nearest_idx]

    # 4. Gather existing + rejected labels
    existing = [
        ld.name for ld in db.exec(
            select(LabelDefinition).where(LabelDefinition.archived_at == None)
        ).all()
    ]
    rejected = [
        cc.name for cc in db.exec(
            select(ConceptCandidate).where(ConceptCandidate.status == "rejected")
        ).all()
    ]

    # 5. Call Gemini
    prompt = _build_discovery_prompt(samples_by_cluster, existing, rejected)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=SUGGEST_CONFIG,
    )

    # 6. Parse response
    concepts_raw: List[Dict[str, Any]] = []
    for part in response.candidates[0].content.parts:
        if part.function_call and part.function_call.name == "suggest_concepts":
            args = dict(part.function_call.args)
            concepts_raw = list(args.get("concepts", []))
            break

    # 7. Save candidates
    run_id = str(uuid.uuid4())[:8]
    candidates: List[ConceptCandidate] = []
    for c in concepts_raw:
        example_data = [{"excerpt": e} for e in c.get("evidence", [])]
        candidate = ConceptCandidate(
            name=c["name"],
            description=c["description"],
            example_messages=json.dumps(example_data),
            status="pending",
            source_run_id=run_id,
        )
        db.add(candidate)
        candidates.append(candidate)

    db.commit()
    for candidate in candidates:
        db.refresh(candidate)

    return candidates
