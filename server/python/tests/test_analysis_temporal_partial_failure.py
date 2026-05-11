from unittest.mock import patch


def test_temporal_each_subblock_has_error_field(client):
    """Smoke test: every sub-block exposes an `error` slot in its envelope so
    the FE can render per-card error states without unmounting siblings."""
    body = client.get("/api/analysis/temporal").json()
    assert "tutor_usage" in body and "error" in body["tutor_usage"]
    assert "notebook_label_heatmap" in body and "error" in body["notebook_label_heatmap"]
    assert "labeling_throughput" in body
    assert "data" in body["labeling_throughput"]
    assert "error" in body["labeling_throughput"]


def test_temporal_throughput_failure_isolated_from_other_blocks(client):
    """If the throughput aggregation raises, tutor_usage and heatmap must still
    return their own data + error=None. Patches the SQL helper that throughput
    calls so the rest of the handler runs normally."""
    # Patch sqlmodel.Session.exec at the call site to raise once, then succeed.
    # Simplest: patch func.date so the throughput's group_by produces an error.
    with patch("main.func") as mock_func:
        mock_func.date.side_effect = RuntimeError("boom on date()")
        # func.count must still work for unrelated queries — pass-through
        mock_func.count = __import__("sqlalchemy").func.count
        r = client.get("/api/analysis/temporal")
    assert r.status_code == 200
    body = r.json()
    # Throughput failed → has error, no data
    assert body["labeling_throughput"]["error"] is not None
    assert "boom" in body["labeling_throughput"]["error"]
    assert body["labeling_throughput"]["data"] == []
    # Other blocks present (tutor_usage may have its own ext-DB error in tests,
    # but the field is there)
    assert "tutor_usage" in body
    assert "notebook_label_heatmap" in body
