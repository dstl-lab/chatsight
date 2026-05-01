"""Gemini prompts and tool schemas for RAG-style concept discovery."""
from __future__ import annotations
import os
from typing import Any, TypedDict

from google import genai
from google.genai import types


client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))


class ConceptDraft(TypedDict, total=False):
    kind: str  # "broad_label" | "co_occurrence"
    name: str
    description: str
    evidence_message_ids: list[dict[str, int]]
    co_occurrence_label_ids: list[int]
    co_occurrence_count: int
    suggested_resolution: str  # for co_occurrence: "make_label" | "merge" | "independent"


# ── Mode A: broad-label discovery ──────────────────────────────────

BROAD_LABEL_TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="suggest_broad_labels",
        description="Propose broad, multi-label-friendly categories.",
        parameters={
            "type": "object",
            "properties": {
                "concepts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "description": {"type": "string"},
                            "evidence_message_indices": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "0-indexed positions in the input list",
                            },
                        },
                        "required": ["name", "description", "evidence_message_indices"],
                    },
                },
            },
            "required": ["concepts"],
        },
    )
])

BROAD_LABEL_CONFIG = types.GenerateContentConfig(
    system_instruction=(
        "You are an education researcher analyzing student-AI tutoring "
        "conversations. The instructor labels messages with multiple BROAD "
        "labels per message — labels are designed to combine, not to be "
        "mutually exclusive. Your job is to find broad themes the schema "
        "doesn't yet cover."
    ),
    temperature=0,
    tools=[BROAD_LABEL_TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["suggest_broad_labels"],
        )
    ),
)


def _build_broad_label_prompt(
    retrieved: list[dict[str, Any]],
    existing_labels: list[dict[str, str]],
    rejected_names: list[str],
) -> str:
    parts: list[str] = []
    parts.append("## Existing Labels (already in use — do NOT re-suggest)")
    parts.append("These labels reflect the instructor's style and granularity.")
    for l in existing_labels:
        desc = f" — {l.get('description', '')}" if l.get("description") else ""
        parts.append(f"- **{l['name']}**{desc}")

    if rejected_names:
        parts.append("\n## Previously Rejected (do NOT suggest)")
        for name in rejected_names:
            parts.append(f"- {name}")

    parts.append("\n## Candidate Messages")
    parts.append(
        "These messages were retrieved as the SCHEMA'S BLIND SPOT — they "
        "are deliberately diverse, NOT a tight cluster. Any single narrow "
        "label cannot span this set."
    )
    parts.append("")
    for i, m in enumerate(retrieved):
        text = m["message_text"][:400]
        parts.append(f"{i}. \"{text}\"")

    parts.append("")
    parts.append("## Task")
    parts.append(
        "Propose BROAD label categories. A useful proposal here:\n"
        "- covers AT LEAST ~15% of the candidate messages above\n"
        "- is meant to CO-APPLY with existing labels, not replace them\n"
        "- is distinct from existing labels (different concept, not a rename)\n"
        "- is named in the SAME style as existing labels (look at their format)\n\n"
        "Do NOT propose narrow sub-categories. If a concept would only fit "
        "one or two messages, skip it. Quality over quantity. It is fine to "
        "return zero proposals if the retrieved set has no broad theme.\n\n"
        "Reference each proposal's evidence by the 0-indexed message numbers "
        "above. Call `suggest_broad_labels` with your proposals."
    )
    return "\n".join(parts)


def generate_broad_labels(
    retrieved: list[dict[str, Any]],
    existing_labels: list[dict[str, Any]],
    rejected_names: list[str],
) -> list[ConceptDraft]:
    """Single Gemini call. Returns drafts with evidence resolved back to
    {chatlog_id, message_index} pairs (not the prompt-local indices)."""
    if not retrieved:
        return []
    prompt = _build_broad_label_prompt(retrieved, existing_labels, rejected_names)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=BROAD_LABEL_CONFIG,
    )

    raw_concepts: list[dict[str, Any]] = []
    for part in response.candidates[0].content.parts:
        fc = getattr(part, "function_call", None)
        if fc and fc.name == "suggest_broad_labels":
            args = dict(fc.args)
            raw_concepts = list(args.get("concepts", []))
            break

    drafts: list[ConceptDraft] = []
    for c in raw_concepts:
        evidence_ids: list[dict[str, int]] = []
        for idx in c.get("evidence_message_indices", []) or []:
            try:
                idx_int = int(idx)
            except (TypeError, ValueError):
                continue
            if 0 <= idx_int < len(retrieved):
                m = retrieved[idx_int]
                evidence_ids.append({
                    "chatlog_id": m["chatlog_id"],
                    "message_index": m["message_index"],
                })
        drafts.append({
            "kind": "broad_label",
            "name": c["name"],
            "description": c.get("description", ""),
            "evidence_message_ids": evidence_ids,
        })
    return drafts


# ── Mode B: co-occurrence evaluation ───────────────────────────────

CO_OCCURRENCE_TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="evaluate_co_occurrence",
        description=(
            "Evaluate whether co-occurring label pairs deserve a combined "
            "label, a merge, or are independent."
        ),
        parameters={
            "type": "object",
            "properties": {
                "evaluations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label_a_id": {"type": "integer"},
                            "label_b_id": {"type": "integer"},
                            "name": {
                                "type": "string",
                                "description": (
                                    "If suggested_resolution=='make_label', "
                                    "the proposed combo name; else empty."
                                ),
                            },
                            "description": {"type": "string"},
                            "suggested_resolution": {
                                "type": "string",
                                "enum": ["make_label", "merge", "independent"],
                            },
                        },
                        "required": [
                            "label_a_id", "label_b_id", "suggested_resolution",
                        ],
                    },
                },
            },
            "required": ["evaluations"],
        },
    )
])

CO_OCCURRENCE_CONFIG = types.GenerateContentConfig(
    system_instruction=(
        "You are evaluating whether pairs of labels that frequently "
        "co-occur represent (a) a coherent THIRD concept worth its own "
        "label, (b) essentially the same thing under two names "
        "(merge candidates), or (c) two genuinely independent things "
        "that just happen to overlap. Be conservative — most pairs are "
        "independent."
    ),
    temperature=0,
    tools=[CO_OCCURRENCE_TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["evaluate_co_occurrence"],
        )
    ),
)


def _build_co_occurrence_prompt(
    pairs: list[dict[str, Any]],
    existing_labels: list[dict[str, Any]],
) -> str:
    parts: list[str] = []
    parts.append("## Existing Labels in the Schema")
    for l in existing_labels:
        desc = f" — {l.get('description', '')}" if l.get("description") else ""
        parts.append(f"- (id={l.get('id', '?')}) **{l['name']}**{desc}")

    parts.append("\n## Frequently Co-occurring Label Pairs")
    for p in pairs:
        parts.append(
            f"- **{p['label_a_name']}** + **{p['label_b_name']}** "
            f"co-occur on {p['count']} messages "
            f"(label_a_id={p['label_a_id']}, label_b_id={p['label_b_id']})"
        )

    parts.append("\n## Task")
    parts.append(
        "For each pair, decide one of:\n"
        "- `make_label`: the combination is a coherent third concept "
        "worth its own broad label (rare; only when the combination "
        "captures something neither label captures alone)\n"
        "- `merge`: the two labels are nearly synonymous; keeping both "
        "fragments the schema\n"
        "- `independent`: the pair is just two real things that often "
        "appear in the same message — no schema action needed\n\n"
        "Default to `independent`. Only suggest `make_label` if you can "
        "name the combined concept in the same style as existing labels. "
        "Call `evaluate_co_occurrence` with one entry per pair."
    )
    return "\n".join(parts)


def generate_co_occurrence_concepts(
    pairs: list[dict[str, Any]],
    existing_labels: list[dict[str, Any]],
) -> list[ConceptDraft]:
    """Single Gemini call across all pairs."""
    if not pairs:
        return []
    prompt = _build_co_occurrence_prompt(pairs, existing_labels)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=CO_OCCURRENCE_CONFIG,
    )

    raw: list[dict[str, Any]] = []
    for part in response.candidates[0].content.parts:
        fc = getattr(part, "function_call", None)
        if fc and fc.name == "evaluate_co_occurrence":
            args = dict(fc.args)
            raw = list(args.get("evaluations", []))
            break

    pair_lookup = {
        tuple(sorted([p["label_a_id"], p["label_b_id"]])): p for p in pairs
    }

    drafts: list[ConceptDraft] = []
    for ev in raw:
        try:
            a, b = int(ev["label_a_id"]), int(ev["label_b_id"])
        except (KeyError, TypeError, ValueError):
            continue
        key = tuple(sorted([a, b]))
        src = pair_lookup.get(key)
        if not src:
            continue
        name = ev.get("name") or f"{src['label_a_name']}+{src['label_b_name']}"
        drafts.append({
            "kind": "co_occurrence",
            "name": name,
            "description": ev.get("description") or "",
            "co_occurrence_label_ids": [a, b],
            "co_occurrence_count": src["count"],
            "suggested_resolution": ev.get("suggested_resolution", "independent"),
            "evidence_message_ids": src.get("example_message_ids", []),
        })
    return drafts
