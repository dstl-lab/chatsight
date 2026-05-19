"""Tests for explore_service conversation + theme novelty (Layer A/B)."""
import json
import numpy as np
import pytest
from sqlmodel import Session

from concept_service import EMBED_MODEL
from explore_service import (
    blended_explore_utility,
    conversation_novelty,
    conversation_centroid,
    conversation_spam_penalty,
    ensure_gradebook,
    explore_candidate_priority,
    student_help_genericness,
    student_help_specificity,
    student_message_copy_paste_likelihood,
    student_message_corpus_rarity,
    theme_novelty,
    warm_explore_candidates,
)
from models import (
    ConversationProfile,
    LabelApplication,
    LabelDefinition,
    LabelExploreGradebook,
    MessageCache,
    MessageEmbedding,
)


def _emb(values):
    v = np.array(values, dtype=np.float32)
    n = np.linalg.norm(v)
    return (v / n).tobytes() if n > 0 else v.tobytes()


def test_conversation_centroid_mean(session):
    for i in range(2):
        session.add(MessageCache(chatlog_id=1, message_index=i, message_text=f"m{i}"))
    session.add(MessageEmbedding(chatlog_id=1, message_index=0, embedding=_emb([1.0, 0.0]), model_version=EMBED_MODEL))
    session.add(MessageEmbedding(chatlog_id=1, message_index=1, embedding=_emb([0.0, 1.0]), model_version=EMBED_MODEL))
    session.commit()
    c = conversation_centroid(session, 1)
    assert c is not None
    assert abs(float(np.linalg.norm(c)) - 1.0) < 0.01


def test_conversation_novelty_high_when_far_from_labeled(session):
    label = LabelDefinition(name="nov", mode="single", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    lid = label.id

    session.add(MessageCache(chatlog_id=10, message_index=0, message_text="a"))
    session.add(MessageCache(chatlog_id=11, message_index=0, message_text="b"))
    session.add(MessageEmbedding(chatlog_id=10, message_index=0, embedding=_emb([1.0, 0.0]), model_version=EMBED_MODEL))
    session.add(MessageEmbedding(chatlog_id=11, message_index=0, embedding=_emb([0.0, 1.0]), model_version=EMBED_MODEL))
    session.add(LabelApplication(label_id=lid, chatlog_id=10, message_index=0, applied_by="human", value="yes"))
    session.commit()

    nov = conversation_novelty(session, lid, 11)
    assert nov is not None
    assert nov > 0.9


def test_theme_novelty_uses_cached_profiles(session):
    label = LabelDefinition(name="theme", mode="single", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    lid = label.id

    session.add(LabelApplication(label_id=lid, chatlog_id=20, message_index=0, applied_by="human", value="yes"))
    session.add(LabelApplication(label_id=lid, chatlog_id=21, message_index=0, applied_by="human", value="no"))
    session.add(
        ConversationProfile(
            label_id=lid,
            chatlog_id=20,
            one_liner="pandas groupby",
            theme_tags_json='["pandas"]',
            summary_embedding=_emb([1.0, 0.0]),
            human_label_count_at_build=2,
        )
    )
    session.add(
        ConversationProfile(
            label_id=lid,
            chatlog_id=21,
            one_liner="matplotlib plots",
            theme_tags_json='["viz"]',
            summary_embedding=_emb([0.0, 1.0]),
            human_label_count_at_build=2,
        )
    )
    session.commit()

    thm = theme_novelty(session, lid, 21)
    assert thm is not None
    assert thm > 0.9


def test_student_help_genericness():
    assert student_help_genericness("help") > 0.85
    assert student_help_genericness("question 1.2") > 0.85
    assert student_help_specificity(
        "Can you give me an example of groupby in the context of this question?"
    ) > 0.6


def test_copy_paste_long_assignment_block():
    pasted = """
    Question 3.4
    Using the following dataset, write a function that computes the mean price
    grouped by category. You should submit a notebook with your code and a short
  written explanation of your approach.
    1. Load the data from the provided CSV.
    2. Clean missing values according to the rubric.
    3. Produce a bar chart of counts by category.
    """
    assert student_message_copy_paste_likelihood(pasted) >= 0.7
    assert student_help_specificity(pasted) < 0.35
    assert student_help_specificity(pasted, corpus_rarity=0.1) < 0.15


def test_copy_paste_traceback():
    tb = "Traceback (most recent call last):\n  File \"main.py\", line 4\n" + "x" * 300
    assert student_message_copy_paste_likelihood(tb) >= 0.85


def test_original_long_question_not_treated_as_paste():
    original = (
        "I'm confused about question 3 — can you give me an example of groupby "
        "being used in the context of this homework question? My merge keeps "
        "dropping rows and I think I'm using the wrong key."
    )
    assert student_message_copy_paste_likelihood(original) < 0.5
    assert student_help_specificity(original) > 0.5


def test_explore_priority_original_over_pasted_block(session):
    pasted = [
        "Question 1\nWrite a function using the dataset below.\n" + "step\n" * 8
    ]
    specific = (
        "Can you give me an example of groupby being used in the context of this question?"
    )
    pri_paste = explore_candidate_priority(
        session, 300, pasted[0], 0, pasted, use_corpus_rarity=False
    )
    pri_specific = explore_candidate_priority(
        session, 301, specific, 0, [specific], use_corpus_rarity=False
    )
    assert pri_specific > pri_paste


def test_conversation_spam_penalty():
    assert conversation_spam_penalty(["help", "help", "question 1.2"]) > 0.4
    assert conversation_spam_penalty(
        ["Can you show an example of merge in this homework question?"]
    ) == 0.0


def test_explore_priority_specific_over_spam_length(session):
    spam_texts = ["help", "help", "question 1.2"]
    specific = (
        "Can you give me an example of groupby being used in the context of this question?"
    )
    pri_spam = explore_candidate_priority(
        session, 202, "help", 0, spam_texts, use_corpus_rarity=False
    )
    pri_specific = explore_candidate_priority(
        session, 203, specific, 0, [specific], use_corpus_rarity=False
    )
    assert pri_specific > pri_spam


def test_student_corpus_rarity(session):
    session.add(MessageCache(chatlog_id=30, message_index=0, message_text="help"))
    session.add(MessageCache(chatlog_id=31, message_index=0, message_text="help"))
    session.add(
        MessageCache(
            chatlog_id=32,
            message_index=0,
            message_text="groupby example in context of lab 3",
        )
    )
    session.add(MessageEmbedding(chatlog_id=30, message_index=0, embedding=_emb([1.0, 0.0]), model_version=EMBED_MODEL))
    session.add(MessageEmbedding(chatlog_id=31, message_index=0, embedding=_emb([0.99, 0.1]), model_version=EMBED_MODEL))
    session.add(MessageEmbedding(chatlog_id=32, message_index=0, embedding=_emb([0.0, 1.0]), model_version=EMBED_MODEL))
    session.commit()
    rare = student_message_corpus_rarity(session, 32, 0)
    common = student_message_corpus_rarity(session, 30, 0)
    assert rare is not None and common is not None
    assert rare > common


def test_blended_utility_renormalizes_missing_components():
    u = blended_explore_utility(0.8, None, 0.6, None, 0.7, 0.75, 0.0)
    assert 0.0 <= u <= 1.0
    assert u > 0.5
    u_spam = blended_explore_utility(0.9, 0.9, 0.9, 0.9, 0.9, 0.9, spam_penalty=0.9)
    assert u_spam < u


def test_ensure_gradebook_skips_without_api_key(session, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    label = LabelDefinition(name="gb", mode="single", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    for i in range(5):
        session.add(
            LabelApplication(
                label_id=label.id,
                chatlog_id=100 + i,
                message_index=0,
                applied_by="human",
                value="yes" if i % 2 == 0 else "no",
            )
        )
    session.commit()
    assert ensure_gradebook(session, label.id) is None


def test_ensure_gradebook_persists_with_mock(session, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    label = LabelDefinition(name="gb2", mode="single", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    for i in range(5):
        session.add(
            LabelApplication(
                label_id=label.id,
                chatlog_id=200 + i,
                message_index=0,
                applied_by="human",
                value="yes",
            )
        )
        session.add(
            MessageCache(
                chatlog_id=200 + i,
                message_index=0,
                message_text=f"msg {i}",
            )
        )
    session.commit()

    monkeypatch.setattr(
        "explore_service.binary_autolabel_service.summarize_batch",
        lambda *a, **k: {"included": ["stuck"], "excluded": ["thanks"]},
    )
    gb = ensure_gradebook(session, label.id)
    assert gb is not None
    assert gb["included"] == ["stuck"]
    row = session.get(LabelExploreGradebook, label.id)
    assert row is not None
    assert json.loads(row.gradebook_json)["excluded"] == ["thanks"]


def test_warm_explore_candidates_noop_without_api_key(session, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    warm_explore_candidates(1, [1, 2], {1: [(0, "hi", None)]}, {1: None})
