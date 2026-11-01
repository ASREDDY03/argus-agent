"""Tests for the build_features() feature-engineering function."""
import pandas as pd
import app as ml_app


def _df(n=10, status=1, ts='2024-06-15 10:30:00'):
    return pd.DataFrame({
        'duration': [100.0] * n,
        'status':   [status] * n,
        'ts':       [ts] * n,
    })


def test_all_feature_cols_present():
    result = ml_app.build_features(_df())
    for col in ml_app.FEATURE_COLS:
        assert col in result.columns, f"Missing feature column: {col}"


def test_hour_of_day_extracted_from_ts():
    # 2024-06-15 10:30:00 → hour 10
    result = ml_app.build_features(_df())
    assert (result['hour_of_day'] == 10).all()


def test_day_of_week_extracted_from_ts():
    # 2024-06-15 is a Saturday → dayofweek = 5
    result = ml_app.build_features(_df())
    assert (result['day_of_week'] == 5).all()


def test_defaults_used_without_ts_column():
    df = pd.DataFrame({'duration': [100.0] * 5, 'status': [1] * 5})
    result = ml_app.build_features(df)
    assert (result['hour_of_day'] == 12).all()
    assert (result['day_of_week'] == 0).all()


def test_no_lookahead_on_oldest_build():
    """Index -1 in DESC order is the *oldest* build — it has no preceding builds
    (shift(1) on the first ASC row is NaN → fillna(0.0)), so its rate must be 0."""
    result = ml_app.build_features(_df(n=10, status=0))
    assert result['rolling_failure_rate'].iloc[-1] == 0.0


def test_high_failure_rate_reflected_in_rolling():
    """5 recent failures should produce a non-zero rolling_failure_rate for later builds."""
    df = pd.DataFrame({
        'duration': [100.0] * 10,
        # DESC order: first 5 are failures, next 5 are successes
        'status':   [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
        'ts':       ['2024-06-15 10:30:00'] * 10,
    })
    result = ml_app.build_features(df)
    assert result['rolling_failure_rate'].max() > 0.0


def test_output_length_matches_input():
    df = _df(n=15)
    result = ml_app.build_features(df)
    assert len(result) == 15


def test_rolling_failure_rate_bounded():
    """Rate must always be in [0, 1]."""
    df = pd.DataFrame({
        'duration': [100.0] * 20,
        'status':   [0, 1] * 10,
        'ts':       ['2024-06-15 10:30:00'] * 20,
    })
    result = ml_app.build_features(df)
    assert (result['rolling_failure_rate'] >= 0.0).all()
    assert (result['rolling_failure_rate'] <= 1.0).all()
