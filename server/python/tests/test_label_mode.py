"""Tests for the `mode` column on LabelDefinition (single-label pivot, Task 0a)."""
from sqlmodel import select

from models import LabelDefinition


def test_label_default_mode_is_multi(session):
    label = LabelDefinition(name="confused")
    session.add(label)
    session.commit()
    session.refresh(label)
    assert label.mode == "multi"


def test_label_can_be_single_mode(session):
    label = LabelDefinition(name="help", mode="single")
    session.add(label)
    session.commit()
    session.refresh(label)
    assert label.mode == "single"


def test_filter_by_mode(session):
    session.add(LabelDefinition(name="multi-1", mode="multi"))
    session.add(LabelDefinition(name="multi-2", mode="multi"))
    session.add(LabelDefinition(name="single-1", mode="single"))
    session.commit()

    multis = session.exec(select(LabelDefinition).where(LabelDefinition.mode == "multi")).all()
    singles = session.exec(select(LabelDefinition).where(LabelDefinition.mode == "single")).all()

    assert len(multis) == 2
    assert len(singles) == 1
    assert singles[0].name == "single-1"
