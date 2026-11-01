"""Tests for the /health endpoint."""
import app as ml_app


def test_health_returns_ok(client):
    r = client.get('/health')
    assert r.status_code == 200
    assert r.get_json()['status'] == 'ok'


def test_health_response_shape(client):
    body = client.get('/health').get_json()
    assert isinstance(body['persisted_samples'], int)
    assert isinstance(body['if_models_cached'], int)
    assert isinstance(body['rf_models_cached'], int)
    assert isinstance(body['stale_threshold_days'], int)
    assert isinstance(body['stale_jobs'], list)
    assert isinstance(body['models'], dict)


def test_health_empty_db(client):
    body = client.get('/health').get_json()
    assert body['persisted_samples'] == 0
    assert body['models'] == {}
    assert body['stale_jobs'] == []


def test_health_stale_threshold_configurable(client, monkeypatch):
    monkeypatch.setattr(ml_app, 'STALE_MODEL_DAYS', 3)
    body = client.get('/health').get_json()
    assert body['stale_threshold_days'] == 3


def test_health_reflects_persisted_samples(client):
    ml_app.save_builds('ci-job', [100, 110, 105], ['SUCCESS', 'SUCCESS', 'FAILURE'])
    body = client.get('/health').get_json()
    assert body['persisted_samples'] == 3


def test_health_job_appears_after_training(client):
    """After /analyze trains an IF model, /health should list the job."""
    client.post('/analyze', json={
        'durations': [100, 110, 105, 90, 115, 108, 102, 97, 120, 95],
        'statuses':  ['SUCCESS'] * 10,
        'latest_status': 'SUCCESS',
        'latest_duration': 95,
        'job_name': 'health-test-job',
    })
    body = client.get('/health').get_json()
    assert 'health-test-job' in body['models']
    info = body['models']['health-test-job']
    assert info['if_age_days'] is not None
    assert info['if_stale'] is False
