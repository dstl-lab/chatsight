from schemas import (
    ConfidenceHistogramBin,
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


def test_single_label_detail_response_with_histogram():
    """Cover the composite SingleLabelDetailResponse + ConfidenceHistogramBin."""
    bin_lo = ConfidenceHistogramBin(range_lo=0.0, range_hi=0.5, count=3)
    bin_hi = ConfidenceHistogramBin(range_lo=0.5, range_hi=1.0, count=7)
    r = SingleLabelDetailResponse(
        id=1,
        name="asks clarifying question",
        description=None,
        phase="autolabel",
        yes_count=10,
        no_count=2,
        review_count=1,
        review_threshold=0.7,
        agreement_vs_gold=None,
        confidence_histogram=[bin_lo, bin_hi],
    )
    assert r.id == 1
    assert r.agreement_vs_gold is None
    assert len(r.confidence_histogram) == 2
    assert r.confidence_histogram[0].count == 3
    assert r.confidence_histogram[1].range_lo == 0.5
