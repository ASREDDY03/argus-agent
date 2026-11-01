"""Tests for the /analyze endpoint."""


def test_missing_body_returns_400(client):
    r = client.post('/analyze', content_type='application/json')
    assert r.status_code == 400


def test_missing_durations_returns_400(client):
    r = client.post('/analyze', json={'statuses': ['SUCCESS']})
    assert r.status_code == 400
    assert 'durations' in r.get_json()['error']


def test_missing_statuses_returns_400(client):
    r = client.post('/analyze', json={'durations': [100]})
    assert r.status_code == 400
    assert 'statuses' in r.get_json()['error']


def test_length_mismatch_returns_400(client):
    r = client.post('/analyze', json={
        'durations': [100, 200],
        'statuses': ['SUCCESS'],
    })
    assert r.status_code == 400


def test_failure_always_included_in_anomalies(client):
    r = client.post('/analyze', json={
        'durations': [100, 110, 105],
        'statuses': ['SUCCESS', 'SUCCESS', 'FAILURE'],
        'latest_status': 'FAILURE',
        'latest_duration': 105,
        'job_name': 'test-job',
    })
    assert r.status_code == 200
    assert 105 in r.get_json()['anomalies']


def test_success_does_not_force_anomaly(client):
    r = client.post('/analyze', json={
        'durations': [100, 110, 105, 108, 103],
        'statuses': ['SUCCESS'] * 5,
        'latest_status': 'SUCCESS',
        'latest_duration': 103,
        'job_name': 'test-job',
    })
    assert r.status_code == 200
    assert isinstance(r.get_json()['anomalies'], list)


def test_small_payload_no_crash(client):
    """Fewer than 3 builds — IF model is skipped, response must still be 200."""
    r = client.post('/analyze', json={
        'durations': [100, 110],
        'statuses': ['SUCCESS', 'SUCCESS'],
        'latest_status': 'SUCCESS',
        'latest_duration': 110,
        'job_name': 'test-job',
    })
    assert r.status_code == 200


def test_zscore_outlier_detected(client):
    """A single build 10x longer than the rest should be flagged via z-score."""
    normal   = [100] * 10
    outlier  = [1000]
    r = client.post('/analyze', json={
        'durations': normal + outlier,
        'statuses': ['SUCCESS'] * 11,
        'latest_status': 'SUCCESS',
        'latest_duration': 1000,
        'job_name': 'zscore-job',
    })
    assert r.status_code == 200
    assert 1000 in r.get_json()['anomalies']


def test_response_contains_anomalies_key(client):
    r = client.post('/analyze', json={
        'durations': [100],
        'statuses': ['SUCCESS'],
        'latest_status': 'SUCCESS',
        'latest_duration': 100,
        'job_name': 'test-job',
    })
    assert r.status_code == 200
    assert 'anomalies' in r.get_json()
