"""
Shared fixtures for the ML service test suite.

Each test gets a fresh, isolated SQLite DB in a pytest tmp_path so tests
never bleed state into each other.  Model caches are cleared between tests
for the same reason.
"""
import os
import pytest

# Set before importing app so the initial os.makedirs uses a writable path.
os.environ.setdefault('ML_DATA_DIR', '/tmp/argus_test_init')

import app as ml_app  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    """Flask test client backed by a clean, per-test SQLite database."""
    ml_app.DATA_DIR = str(tmp_path)
    ml_app.DB_PATH  = str(tmp_path / 'argus_ml.db')
    ml_app.init_db()

    # Clear in-memory model caches so each test trains from scratch.
    ml_app._if_cache.clear()
    ml_app._rf_cache.clear()
    ml_app._if_trained_on.clear()
    ml_app._rf_trained_on.clear()

    with ml_app.app.test_client() as c:
        yield c
