"""Tests for model persistence helpers — disk reload and cache-hit paths.

load_if_model and load_rf_model each have three paths:
  1. cache hit  — model already in _if_cache / _rf_cache
  2. disk reload — file exists on disk but cache was cleared
  3. miss        — file does not exist → returns None

The main test suite exercises path 3 and trains fresh models each test.
These tests cover paths 1 and 2 (lines 99-102, 112, 115-118 in app.py).
"""
import app as ml_app


def test_load_if_model_returns_none_when_missing(client):
    assert ml_app.load_if_model('no-such-job') is None


def test_load_rf_model_returns_none_when_missing(client):
    assert ml_app.load_rf_model('no-such-job') is None


def test_load_if_model_reloads_from_disk(client):
    """After cache is cleared the model is re-read from disk (lines 99-102)."""
    # Train and persist an IF model
    client.post('/analyze', json={
        'durations': [100, 110, 105, 90, 115, 108, 102, 97, 120, 95],
        'statuses':  ['SUCCESS'] * 10,
        'latest_status': 'SUCCESS',
        'latest_duration': 95,
        'job_name': 'cache-if-job',
    })
    assert ml_app.load_if_model('cache-if-job') is not None

    # Clear in-memory cache — next load must come from disk
    ml_app._if_cache.clear()
    reloaded = ml_app.load_if_model('cache-if-job')
    assert reloaded is not None   # disk reload path (lines 99-102)


def test_load_rf_model_reloads_from_disk(client):
    """After cache is cleared the RF model is re-read from disk (lines 115-118)."""
    history = [{'duration': 100.0, 'status': 1, 'ts': '2024-01-01 10:00:00'}] * 15
    client.post('/predict-failure', json={'job_name': 'cache-rf-job', 'history': history})
    assert ml_app.load_rf_model('cache-rf-job') is not None

    ml_app._rf_cache.clear()
    reloaded = ml_app.load_rf_model('cache-rf-job')
    assert reloaded is not None   # disk reload path (lines 115-118)


def test_load_rf_model_cache_hit(client):
    """Second call with the same job hits the in-memory cache (line 112)."""
    history = [{'duration': 100.0, 'status': 1, 'ts': '2024-01-01 10:00:00'}] * 15
    client.post('/predict-failure', json={'job_name': 'cache-hit-job', 'history': history})

    # First load populates the cache (or returns from it if already there)
    first = ml_app.load_rf_model('cache-hit-job')
    assert first is not None

    # Second load: cache already populated — hits line 112 (return _rf_cache[job_name])
    second = ml_app.load_rf_model('cache-hit-job')
    assert second is first   # same object from cache
