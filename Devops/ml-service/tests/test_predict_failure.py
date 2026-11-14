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


def test_feature_mismatch_forces_retrain(client):
    """ValueError recovery path (lines 280-290): a model trained on 1 feature
    will raise ValueError when predict_proba is called with 4 features.
    The endpoint should catch it, retrain on the correct features, and still
    return a valid prob_failure.
    """
    import numpy as np
    import app as ml_app
    from sklearn.ensemble import RandomForestClassifier

    n = 15
    history = _history(n, 1)[:10] + _history(n, 0)[:5]

    # Train and save a bad model on 1 feature only
    bad_clf = RandomForestClassifier(n_estimators=5, random_state=42)
    X_bad = np.array([[100 + i] for i in range(n)])
    y_bad = [1 if i % 3 else 0 for i in range(n)]
    bad_clf.fit(X_bad, y_bad)
    ml_app.save_rf_model('mismatch-job', bad_clf)

    # Pretend we already trained on n samples so the endpoint skips auto-retrain
    ml_app._rf_trained_on['mismatch-job'] = n

    r = client.post('/predict-failure', json={
        'job_name': 'mismatch-job',
        'history': history,
    })
    assert r.status_code == 200
    body = r.get_json()
    assert 'prob_failure' in body
    assert 0.0 <= body['prob_failure'] <= 1.0
