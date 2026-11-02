"""Tests for the /retrain endpoint (async — returns 202 immediately)."""
import time
import app as ml_app


def test_retrain_returns_202_accepted(client):
    """Endpoint must return 202 and not block."""
    r = client.post('/retrain', json={'job_name': 'empty-job'})
    assert r.status_code == 202


def test_retrain_body_contains_status_and_jobs(client):
    r = client.post('/retrain', json={'job_name': 'empty-job'})
    body = r.get_json()
    assert body['status'] == 'accepted'
    assert 'empty-job' in body['jobs']


def test_retrain_all_jobs_lists_all(client):
    ml_app.save_builds('job-a', [100] * 7, ['SUCCESS'] * 7)
    ml_app.save_builds('job-b', [200] * 7, ['SUCCESS'] * 7)
    r = client.post('/retrain', json={})
    assert r.status_code == 202
    body = r.get_json()
    assert set(body['jobs']) == {'job-a', 'job-b'}


def test_retrain_trains_models_in_background(client):
    """Background thread should train and persist models within a short window."""
    ml_app.save_builds('bg-job', [100, 110, 105, 90, 120, 95, 115], ['SUCCESS'] * 7)
    r = client.post('/retrain', json={'job_name': 'bg-job'})
    assert r.status_code == 202

    # Give the daemon thread up to 3 s to finish training
    deadline = time.time() + 3.0
    while time.time() < deadline:
        if ml_app.load_if_model('bg-job') is not None:
            break
        time.sleep(0.05)

    assert ml_app.load_if_model('bg-job') is not None, "IF model not persisted after background retrain"
    assert ml_app.load_rf_model('bg-job') is not None, "RF model not persisted after background retrain"
