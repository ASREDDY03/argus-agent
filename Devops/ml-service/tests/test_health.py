"""Tests for the /health endpoint."""
import os
import time
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


def test_health_shows_rf_model_after_predict_failure(client):
    """After /predict-failure trains an RF model, /health should include rf_age_days.

    /health only lists jobs that have rows in build_history, so we must
    persist builds via save_builds first (predict-failure doesn't do that).
    """
    durations = [100.0 + i for i in range(15)]
    statuses  = ['SUCCESS'] * 10 + ['FAILURE'] * 5
    ml_app.save_builds('rf-job', durations, statuses)

    history = [
        {'duration': d, 'status': 1 if s == 'SUCCESS' else 0, 'ts': '2024-01-01 10:00:00'}
        for d, s in zip(durations, statuses)
    ]
    client.post('/predict-failure', json={'job_name': 'rf-job', 'history': history})

    body = client.get('/health').get_json()
    assert 'rf-job' in body['models']
    info = body['models']['rf-job']
    assert info['rf_age_days'] is not None   # lines 413-415
    assert info['rf_stale'] is False


def test_health_flags_stale_model(client, monkeypatch):
    """A model whose file is older than STALE_MODEL_DAYS appears in stale_jobs."""
    monkeypatch.setattr(ml_app, 'STALE_MODEL_DAYS', 0)  # everything is immediately stale

    client.post('/analyze', json={
        'durations': [100, 110, 105, 90, 115, 108, 102, 97, 120, 95],
        'statuses':  ['SUCCESS'] * 10,
        'latest_status': 'SUCCESS',
        'latest_duration': 95,
        'job_name': 'stale-job',
    })

    # Push the IF model file's mtime into the past so age_days > 0 > STALE_MODEL_DAYS=0
    if_path = ml_app._if_model_path('stale-job')
    past = time.time() - 86400  # 1 day ago
    os.utime(if_path, (past, past))

    body = client.get('/health').get_json()
    assert 'stale-job' in body['stale_jobs']   # line 422
