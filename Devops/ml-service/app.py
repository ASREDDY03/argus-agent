from flask import Flask, request, jsonify
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from prometheus_flask_exporter import PrometheusMetrics
import numpy as np
import pandas as pd
import re
import sqlite3
import pickle
import os

app = Flask(__name__)
metrics = PrometheusMetrics(app)

DATA_DIR = os.environ.get('ML_DATA_DIR', '/data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'argus_ml.db')

# ── In-memory model caches ────────────────────────────────────────────────────
_rf_cache: dict = {}
_if_cache: dict = {}
# Tracks how many samples each IF/RF model was last trained on — used to detect new data
_if_trained_on: dict = {}
_rf_trained_on: dict = {}

# ── SQLite persistence ────────────────────────────────────────────────────────

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS build_history (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            job_name  TEXT NOT NULL,
            duration  REAL NOT NULL,
            status    INTEGER NOT NULL,   -- 1=SUCCESS, 0=FAILURE
            ts        DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Drop the old value-based unique index that incorrectly collapsed distinct builds
    # sharing the same duration+status (e.g. ten 120s SUCCESS builds → stored as one).
    conn.execute('DROP INDEX IF EXISTS uq_build')
    conn.commit()
    conn.close()

def save_builds(job_name, durations, statuses):
    conn = sqlite3.connect(DB_PATH)
    for d, s in zip(durations, statuses):
        status_int = 1 if str(s).upper() == 'SUCCESS' else 0
        conn.execute(
            'INSERT INTO build_history (job_name, duration, status) VALUES (?, ?, ?)',
            (job_name, float(d), status_int)
        )
    conn.commit()
    conn.close()

def load_job_durations(job_name):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        'SELECT duration FROM build_history WHERE job_name = ? ORDER BY ts DESC LIMIT 500',
        (job_name,)
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]

def load_job_history(job_name):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        'SELECT duration, status, ts FROM build_history WHERE job_name = ? ORDER BY ts DESC LIMIT 200',
        (job_name,)
    ).fetchall()
    conn.close()
    return [{'duration': r[0], 'status': r[1], 'ts': r[2]} for r in rows]

def count_all_samples():
    conn = sqlite3.connect(DB_PATH)
    count = conn.execute('SELECT COUNT(*) FROM build_history').fetchone()[0]
    conn.close()
    return count

# ── Model persistence (per-job) ───────────────────────────────────────────────

def _if_model_path(job_name):
    safe = re.sub(r'[^a-zA-Z0-9_-]', '_', job_name)
    return os.path.join(DATA_DIR, f'if_model_{safe}.pkl')

def _rf_model_path(job_name):
    safe = re.sub(r'[^a-zA-Z0-9_-]', '_', job_name)
    return os.path.join(DATA_DIR, f'rf_model_{safe}.pkl')

def load_if_model(job_name):
    if job_name in _if_cache:
        return _if_cache[job_name]
    path = _if_model_path(job_name)
    if os.path.exists(path):
        with open(path, 'rb') as f:
            model = pickle.load(f)
        _if_cache[job_name] = model
        return model
    return None

def save_if_model(job_name, model):
    _if_cache[job_name] = model
    with open(_if_model_path(job_name), 'wb') as f:
        pickle.dump(model, f)

def load_rf_model(job_name):
    if job_name in _rf_cache:
        return _rf_cache[job_name]
    path = _rf_model_path(job_name)
    if os.path.exists(path):
        with open(path, 'rb') as f:
            model = pickle.load(f)
        _rf_cache[job_name] = model
        return model
    return None

def save_rf_model(job_name, model):
    _rf_cache[job_name] = model
    with open(_rf_model_path(job_name), 'wb') as f:
        pickle.dump(model, f)

FEATURE_COLS = ['duration', 'hour_of_day', 'day_of_week', 'rolling_failure_rate']

def build_features(df):
    """Enrich a history DataFrame with time and momentum features.

    Expects columns: duration, status, ts (all present after load_job_history).
    Returns a new DataFrame with FEATURE_COLS added.
    """
    df = df.copy()
    if 'ts' in df.columns:
        ts = pd.to_datetime(df['ts'], errors='coerce')
        df['hour_of_day'] = ts.dt.hour.fillna(12).astype(int)
        df['day_of_week'] = ts.dt.dayofweek.fillna(0).astype(int)
    else:
        df['hour_of_day'] = 12
        df['day_of_week'] = 0

    # Rolling failure rate of the 5 builds preceding each build.
    # Computed in ascending order then restored to DESC to avoid look-ahead.
    df_asc = df.iloc[::-1].reset_index(drop=True)
    df_asc['rolling_failure_rate'] = (
        (1 - df_asc['status'])
        .rolling(5, min_periods=1).mean()
        .shift(1)
        .fillna(0.0)
    )
    return df_asc.iloc[::-1].reset_index(drop=True)

def _job_contamination(job_name):
    """Estimate IF contamination from the observed failure rate, clamped to [0.05, 0.4]."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        'SELECT AVG(1 - status) FROM build_history WHERE job_name = ?', (job_name,)
    ).fetchone()
    conn.close()
    failure_rate = row[0] if row and row[0] is not None else 0.1
    return max(0.05, min(0.4, failure_rate))

def get_or_train_if_model(job_name):
    # save_builds was already called before this — DB is the authoritative source.
    all_durations = load_job_durations(job_name)
    n = len(all_durations)
    model = load_if_model(job_name)

    if model is None or n > _if_trained_on.get(job_name, 0):
        contamination = _job_contamination(job_name)
        X = np.array(all_durations).reshape(-1, 1)
        model = IsolationForest(contamination=contamination, random_state=42)
        model.fit(X)
        save_if_model(job_name, model)
        _if_trained_on[job_name] = n
        print(f"[ML] IF model retrained for {job_name} on {n} samples (contamination={contamination:.2f})")

    return model

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/analyze', methods=['POST'])
def analyze():
    print("[ML SERVICE] /analyze called")
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body must be JSON'}), 400
    if not isinstance(data.get('durations'), list):
        return jsonify({'error': 'durations must be a list'}), 400
    if not isinstance(data.get('statuses'), list):
        return jsonify({'error': 'statuses must be a list'}), 400
    if len(data['durations']) != len(data['statuses']):
        return jsonify({'error': 'durations and statuses must have the same length'}), 400

    durations       = np.array(data['durations'])
    statuses        = data['statuses']
    latest_status   = data.get('latest_status', '')
    latest_duration = data.get('latest_duration', 0)
    job_name        = data.get('job_name', 'unknown')

    print(f"[ML] job={job_name} durations={durations} latest_status={latest_status}")

    anomalies = []

    # Always flag FAILURE
    if latest_status == 'FAILURE':
        anomalies.append(int(latest_duration))
        print(f"[ML] FAILURE anomaly: {latest_duration}")

    if len(durations) > 2:
        # Persist incoming builds
        save_builds(job_name, durations, statuses)

        # Per-job IF model for detection
        model = get_or_train_if_model(job_name)
        preds = model.predict(durations.reshape(-1, 1))
        for i, pred in enumerate(preds):
            if pred == -1:
                anomalies.append(int(durations[i]))

        # Also flag statistical outliers (z-score > 2)
        mean, std = durations.mean(), durations.std()
        if std > 0:
            for d in durations:
                if abs(d - mean) > 2 * std and int(d) not in anomalies:
                    anomalies.append(int(d))

        print(f"[ML] Anomalies detected: {anomalies}")

    return jsonify({'anomalies': anomalies})


@app.route('/predict-failure', methods=['POST'])
def predict_failure():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body must be JSON'}), 400
    job_name = data.get('job_name', 'default')

    # Prefer persisted history from DB; fall back to request payload
    history = load_job_history(job_name) or data.get('history', [])
    if len(history) < 5:
        return jsonify({'prob_failure': 0.0, 'note': 'Not enough data'})

    df = build_features(pd.DataFrame(history))
    X = df[FEATURE_COLS]
    y = df['status']

    # Retrain whenever we have more data than the last training run
    n = len(history)
    clf = load_rf_model(job_name)
    if clf is None or n > _rf_trained_on.get(job_name, 0):
        clf = RandomForestClassifier(n_estimators=10, random_state=42)
        clf.fit(X, y)
        save_rf_model(job_name, clf)
        _rf_trained_on[job_name] = n
        print(f"[ML] RF model retrained for {job_name} on {n} samples with features {FEATURE_COLS}")

    # Features for the next (hypothetical) build:
    # - duration: use most recent as proxy
    # - time: use now (we don't know when it will run)
    # - rolling_failure_rate: failure rate of the last 5 actual builds
    now = pd.Timestamp.now()
    next_failure_rate = float((1 - df['status'].iloc[:5]).mean())
    next_features = [[
        df['duration'].iloc[0],
        now.hour,
        now.dayofweek,
        next_failure_rate,
    ]]

    # Guard: if training data has only one class, predict_proba won't have a [1] column
    classes = list(clf.classes_)
    if 1 not in classes:
        return jsonify({'prob_failure': 1.0, 'note': 'No successful builds in training data'})
    success_idx = classes.index(1)
    try:
        prob_failure = 1 - clf.predict_proba(next_features)[0][success_idx]
    except ValueError:
        # Old model trained on a different feature set — force retrain
        clf = RandomForestClassifier(n_estimators=10, random_state=42)
        clf.fit(X, y)
        save_rf_model(job_name, clf)
        _rf_trained_on[job_name] = n
        classes = list(clf.classes_)
        if 1 not in classes:
            return jsonify({'prob_failure': 1.0, 'note': 'No successful builds in training data'})
        success_idx = classes.index(1)
        prob_failure = 1 - clf.predict_proba(next_features)[0][success_idx]
    return jsonify({'prob_failure': float(prob_failure)})


# Ordered from most-specific to least-specific; all matching categories are returned.
_LOG_PATTERNS = [
    ('OutOfMemory',      r'OutOfMemoryError|out of memory|heap space|GC overhead limit exceeded'),
    ('ConnectionError',  r'Connection refused|ECONNREFUSED|connection timed out|UnknownHostException|Network is unreachable'),
    ('NullPointer',      r'NullPointerException'),
    ('TestFailure',      r'Tests run:.*Failures: [1-9]|AssertionError|FAILED.*test|test.*FAILED'),
    ('CompileError',     r'error: cannot find symbol|[Cc]ompilation fail|[Cc]ompile error'),
    ('PermissionDenied', r'Permission denied|EACCES|Access is denied'),
    ('DependencyError',  r'Could not resolve|Could not find artifact|[Dd]ependency.*not found|Unresolved depend'),
    ('Timeout',          r'[Tt]imed? ?out|ETIMEDOUT|Read timed out|socket timeout'),
    ('DiskSpace',        r'No space left on device|ENOSPC|disk.*full'),
    ('DockerError',      r'[Dd]ocker.*[Ee]rror|container.*exited [1-9]|image.*not found'),
]

MAX_LOG_BYTES = 5 * 1024 * 1024  # 5 MB

@app.route('/analyze-logs', methods=['POST'])
def analyze_logs():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body must be JSON'}), 400
    logs = data.get('logs', '')
    if not logs:
        return jsonify({'root_causes': []})
    if len(logs.encode('utf-8')) > MAX_LOG_BYTES:
        return jsonify({'error': 'Log payload exceeds 5 MB limit'}), 413

    error_lines = [
        line for line in logs.split('\n')
        if re.search(r'error|exception|fail|warn', line, re.IGNORECASE)
    ]

    matched = [
        category
        for category, pattern in _LOG_PATTERNS
        if any(re.search(pattern, line) for line in error_lines)
    ]

    return jsonify({'root_causes': matched, 'error_lines': error_lines[:20]})


@app.route('/retrain', methods=['POST'])
def retrain():
    """Force-retrain IF and RF models for a job (or all jobs if job_name omitted)."""
    data = request.get_json(silent=True) or {}
    job_name = data.get('job_name')

    def retrain_job(name):
        durations = load_job_durations(name)
        history   = load_job_history(name)
        results   = {'job': name}

        if len(durations) >= 3:
            X = np.array(durations).reshape(-1, 1)
            if_model = IsolationForest(contamination=_job_contamination(name), random_state=42)
            if_model.fit(X)
            save_if_model(name, if_model)
            _if_trained_on[name] = len(durations)
            results['if_samples'] = len(durations)
        else:
            results['if_samples'] = 0
            results['if_skipped'] = 'need >= 3 samples'

        if len(history) >= 5:
            df = build_features(pd.DataFrame(history))
            clf = RandomForestClassifier(n_estimators=10, random_state=42)
            clf.fit(df[FEATURE_COLS], df['status'])
            save_rf_model(name, clf)
            _rf_trained_on[name] = len(history)
            results['rf_samples'] = len(history)
        else:
            results['rf_samples'] = 0
            results['rf_skipped'] = 'need >= 5 samples'

        print(f"[ML] /retrain completed for {name}")
        return results

    if job_name:
        return jsonify(retrain_job(job_name))

    # Retrain all jobs that have data in the DB
    conn = sqlite3.connect(DB_PATH)
    job_names = [r[0] for r in conn.execute('SELECT DISTINCT job_name FROM build_history').fetchall()]
    conn.close()
    return jsonify({'retrained': [retrain_job(n) for n in job_names]})


@app.route('/health', methods=['GET'])
def health():
    total = count_all_samples()
    return jsonify({
        'status': 'ok',
        'persisted_samples': total,
        'if_models_cached': len(_if_cache),
        'rf_models_cached': len(_rf_cache),
    })


# Init DB at import time so gunicorn workers pick it up
init_db()
print(f"[ML] DB: {DB_PATH}")

if __name__ == '__main__':
    # For local development only. Production uses gunicorn (see Dockerfile CMD).
    app.run(host='0.0.0.0', port=8000)
