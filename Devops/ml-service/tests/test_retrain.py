"""Tests for the /retrain endpoint."""
import app as ml_app


def test_retrain_no_data_skips_both_models(client):
    r = client.post('/retrain', json={'job_name': 'empty-job'})
    assert r.status_code == 200
    body = r.get_json()
    assert body['if_samples'] == 0
    assert body['rf_samples'] == 0
    assert 'if_skipped' in body
    assert 'rf_skipped' in body


def test_retrain_with_enough_data_trains_both(client):
    ml_app.save_builds('ci-job', [100, 110, 105, 90, 120, 95, 115], ['SUCCESS'] * 7)
    r = client.post('/retrain', json={'job_name': 'ci-job'})
    assert r.status_code == 200
    body = r.get_json()
    assert body['if_samples'] == 7
    assert body['rf_samples'] == 7


def test_retrain_partial_data_trains_only_if(client):
    """3 samples → IF trains (needs ≥3), RF skips (needs ≥5)."""
    ml_app.save_builds('partial-job', [100, 110, 105], ['SUCCESS'] * 3)
    r = client.post('/retrain', json={'job_name': 'partial-job'})
    assert r.status_code == 200
    body = r.get_json()
    assert body['if_samples'] == 3
    assert body['rf_samples'] == 0
    assert 'rf_skipped' in body


def test_retrain_all_jobs(client):
    ml_app.save_builds('job-a', [100] * 7, ['SUCCESS'] * 7)
    ml_app.save_builds('job-b', [200] * 7, ['SUCCESS'] * 7)
    r = client.post('/retrain', json={})
    assert r.status_code == 200
    body = r.get_json()
    assert 'retrained' in body
    job_names = {entry['job'] for entry in body['retrained']}
    assert job_names == {'job-a', 'job-b'}
