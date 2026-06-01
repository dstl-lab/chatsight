import study_scope
import queue_service
import decision_service
from models import MessageCache, LabelDefinition


def _seed(session, chatlog_id, message_index, notebook):
    session.add(MessageCache(
        chatlog_id=chatlog_id, message_index=message_index,
        message_text=f"msg {chatlog_id}.{message_index}", notebook=notebook,
    ))
    session.commit()


def test_queue_scope_matches_week3_lab_and_hw():
    assert study_scope.notebook_in_scope("lab1.ipynb", study_scope.QUEUE_SCOPE)
    assert study_scope.notebook_in_scope("lab01.ipynb", study_scope.QUEUE_SCOPE)
    assert study_scope.notebook_in_scope("hw01.ipynb", study_scope.QUEUE_SCOPE)
    assert study_scope.notebook_in_scope("hw1.ipynb", study_scope.QUEUE_SCOPE)


def test_run_scope_matches_week8_lab_and_hw():
    assert study_scope.notebook_in_scope("lab5.ipynb", study_scope.RUN_SCOPE)
    assert study_scope.notebook_in_scope("hw05.ipynb", study_scope.RUN_SCOPE)


def test_out_of_scope_and_none():
    assert not study_scope.notebook_in_scope("lab2.ipynb", study_scope.QUEUE_SCOPE)
    assert not study_scope.notebook_in_scope("lab15.ipynb", study_scope.QUEUE_SCOPE)
    assert not study_scope.notebook_in_scope("lab1.ipynb", study_scope.RUN_SCOPE)
    assert not study_scope.notebook_in_scope(None, study_scope.QUEUE_SCOPE)


def test_scope_for_mode():
    assert study_scope.scope_for_mode("single") == study_scope.RUN_SCOPE
    assert study_scope.scope_for_mode("multi") == study_scope.QUEUE_SCOPE


def test_queue_returns_only_week3(client, session):
    _seed(session, 1, 0, "lab1.ipynb")   # in scope (Week 3)
    _seed(session, 2, 0, "lab5.ipynb")   # out of scope (Week 8)
    _seed(session, 3, 0, "lab2.ipynb")   # out of scope
    resp = client.get("/api/queue?limit=50")
    assert resp.status_code == 200
    ids = {row["chatlog_id"] for row in resp.json()}
    assert ids == {1}


def test_queue_stats_counts_only_week3(client, session):
    _seed(session, 1, 0, "lab1.ipynb")
    _seed(session, 2, 0, "hw1.ipynb")
    _seed(session, 3, 0, "lab5.ipynb")
    stats = client.get("/api/queue/stats").json()
    assert stats["total_messages"] == 2


def test_run_next_returns_only_week8(session):
    # Seed an in-scope (Week 8) and an out-of-scope conversation.
    _seed(session, 10, 0, "lab5.ipynb")   # Week 8 — in scope for single mode
    _seed(session, 11, 0, "lab1.ipynb")   # Week 3 — out of scope for single mode
    label = LabelDefinition(name="needs help", mode="single", phase="labeling")
    session.add(label)
    session.commit()

    picks = set()
    for _ in range(10):
        payload = queue_service.next_message_for_label(session, label.id)
        if payload:
            picks.add(payload["chatlog_id"])
    assert picks <= {10}
    assert 11 not in picks
