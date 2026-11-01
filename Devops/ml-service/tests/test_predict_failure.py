"""Tests for the /predict-failure endpoint."""


def _history(n, status):
    return [{'duration': 100.0, 'status': status, 'ts': '2024-01-01 10:00:00'}] * n


def test_missing_body_returns_400(client):
    r = client.post('/predict-failure', content_type='application/json')
    assert r.status_code == 400


def test_not_enough_data_returns_zero(client):
    r = client.post('/predict-failure', json={
        'job_name': 'test-job',
        'history': _history(4, 1),
    })
    assert r.status_code == 200
    body = r.get_json()
    assert body['prob_failure'] == 0.0
    assert 'note' in body


def test_all_successes_low_probability(client):
    r = client.post('/predict-failure', json={
        'job_name': 'reliable-job',
        'history': _history(20, 1),
    })
    assert r.status_code == 200
    assert r.get_json()['prob_failure'] < 0.5


def test_all_failures_returns_guard_value(client):
    """All-failure training data hits the no-success-class guard → 1.0."""
    r = client.post('/predict-failure', json={
        'job_name': 'broken-job',
        'history': _history(20, 0),
    })
    assert r.status_code == 200
    body = r.get_json()
    assert body['prob_failure'] == 1.0


def test_probability_in_valid_range(client):
    mixed = _history(10, 1) + _history(5, 0)
    r = client.post('/predict-failure', json={
        'job_name': 'flaky-job',
        'history': mixed,
    })
    assert r.status_code == 200
    prob = r.get_json()['prob_failure']
    assert 0.0 <= prob <= 1.0


def test_response_contains_prob_failure_key(client):
    r = client.post('/predict-failure', json={
        'job_name': 'test-job',
        'history': _history(5, 1),
    })
    assert r.status_code == 200
    assert 'prob_failure' in r.get_json()
