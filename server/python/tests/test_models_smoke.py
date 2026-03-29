from models import LabelDefinition, LabelApplication, LabelingSession, SkippedMessage

def test_model_classes_importable():
    ld = LabelDefinition(name="Concept Question")
    assert ld.name == "Concept Question"
    assert ld.description is None
