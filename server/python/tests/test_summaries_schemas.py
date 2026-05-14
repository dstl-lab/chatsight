from schemas import (
    SingleLabelDetailResponse,
    MessageListItem,
    MessageListResponse,
    ConversationTurn,
    MessageDetailResponse,
    FlipRequest,
    NoteRequest,
    LabelUpdateRequest,
)


def test_message_list_item_minimal():
    item = MessageListItem(
        chatlog_id=1, message_index=0, text="hello", confidence=0.5,
        verdict="yes", applied_by="ai", flagged=False, has_note=False,
        notebook=None,
    )
    assert item.verdict == "yes"


def test_message_detail_includes_context_turns():
    turn = ConversationTurn(role="tutor", turn_index=5, text="try median")
    detail = MessageDetailResponse(
        chatlog_id=1, message_index=6, text="ok",
        confidence=0.62, verdict="yes", applied_by="ai",
        matched_pattern="questioning own work", rationale="...",
        flagged=False, note=None,
        context_before=[turn], context_after=[],
        notebook=None, turn_index=6, total_turns=11,
    )
    assert detail.context_before[0].role == "tutor"


def test_label_update_request_all_fields_optional():
    # Empty patch is valid — used for "no-op" PATCH responses.
    LabelUpdateRequest()
    # Partial patch:
    LabelUpdateRequest(name="new-name")
    LabelUpdateRequest(review_threshold=0.6)
