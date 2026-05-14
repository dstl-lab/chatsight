def test_milestones_default_course(client):
    r = client.get("/api/analysis/milestones?course=dsc10_wi26")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert all("title" in m and "date" in m and "kind" in m for m in data)


def test_milestones_404_for_missing_course(client):
    r = client.get("/api/analysis/milestones?course=does_not_exist")
    assert r.status_code == 404


def test_milestones_default_course_param_omitted(client):
    r = client.get("/api/analysis/milestones")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
