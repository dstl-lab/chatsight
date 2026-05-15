from sqlmodel import Session
from models import LabelApplication, LabelDefinition


def test_label_application_carries_new_fields(engine):
    with Session(engine) as session:
        label = LabelDefinition(name="self-correction", description="catches own mistake", mode="single")
        session.add(label)
        session.commit()
        session.refresh(label)

        row = LabelApplication(
            label_id=label.id,
            chatlog_id=1,
            message_index=0,
            applied_by="ai",
            value="yes",
            confidence=0.58,
            matched_pattern="questioning own work",
            rationale="Student explicitly recognizes they misread the prompt.",
            flagged=False,
            note=None,
        )
        session.add(row)
        session.commit()
        session.refresh(row)

        assert row.matched_pattern == "questioning own work"
        assert row.rationale.startswith("Student explicitly")
        assert row.flagged is False
        assert row.note is None

        # Also verify the True / non-null paths round-trip.
        row.flagged = True
        row.note = "needs re-review"
        session.add(row)
        session.commit()
        session.refresh(row)

        assert row.flagged is True
        assert row.note == "needs re-review"
