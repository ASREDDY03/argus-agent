from flask import Flask, request, jsonify
from sklearn.ensemble import IsolationForest, RandomForestClassifier
import numpy as np
import pandas as pd
import nltk
from nltk.tokenize import word_tokenize
from collections import Counter
import re
import sqlite3
import pickle
import os

app = Flask(__name__)

DATA_DIR = os.environ.get('ML_DATA_DIR', '/data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'argus_ml.db')

# ── In-memory model caches ────────────────────────────────────────────────────
_rf_cache: dict = {}
_if_cache: dict = {}

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
    # Unique index makes INSERT OR IGNORE actually deduplicate rows
    conn.execute('''
        CREATE UNIQUE INDEX IF NOT EXISTS uq_build
        ON build_history (job_name, duration, status)
    ''')
    conn.commit()
    conn.close()

def save_builds(job_name, durations, statuses):
    conn = sqlite3.connect(DB_PATH)
    for d, s in zip(durations, statuses):
        status_int = 1 if str(s).upper() == 'SUCCESS' else 0
        conn.execute(
            'INSERT OR IGNORE INTO build_history (job_name, duration, status) VALUES (?, ?, ?)',
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
        'SELECT duration, status FROM build_history WHERE job_name = ? ORDER BY ts DESC LIMIT 200',
        (job_name,)
    ).fetchall()
    conn.close()
    return [{'duration': r[0], 'status': r[1]} for r in rows]

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

def get_or_train_if_model(job_name, durations):
    model = load_if_model(job_name)
    persisted = load_job_durations(job_name)
    combined = list(set(persisted + list(durations)))

    if model is None or len(combined) > len(persisted):
        X = np.array(combined).reshape(-1, 1)
        model = IsolationForest(contamination=0.1, random_state=42)
        model.fit(X)
        save_if_model(job_name, model)
        print(f"[ML] IF model retrained for {job_name} on {len(combined)} samples")

    return model

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/analyze', methods=['POST'])
def analyze():
    print("[ML SERVICE] /analyze called")
    data = request.get_json()
    durations       = np.array(data.get('durations', []))
    statuses        = data.get('statuses', [])
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
        model = get_or_train_if_model(job_name, durations)
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
    data = request.json
    job_name = data.get('job_name', 'default')

    # Prefer persisted history from DB; fall back to request payload
    history = load_job_history(job_name) or data.get('history', [])
    if len(history) < 5:
        return jsonify({'prob_failure': 0.0, 'note': 'Not enough data'})

    df = pd.DataFrame(history)
    X = df[['duration']]
    y = df['status']

    # Only train when no saved model exists — don't throw away the warm model
    clf = load_rf_model(job_name)
    if clf is None:
        clf = RandomForestClassifier(n_estimators=10, random_state=42)
        clf.fit(X, y)
        save_rf_model(job_name, clf)

    # Use the most recent build duration (history is ordered DESC)
    next_duration = df['duration'].iloc[0]

    # Guard: if training data has only one class, predict_proba won't have a [1] column
    classes = list(clf.classes_)
    if 1 not in classes:
        return jsonify({'prob_failure': 1.0, 'note': 'No successful builds in training data'})
    success_idx = classes.index(1)
    prob_failure = 1 - clf.predict_proba([[next_duration]])[0][success_idx]
    return jsonify({'prob_failure': float(prob_failure)})


@app.route('/analyze-logs', methods=['POST'])
def analyze_logs():
    data = request.json
    logs = data.get('logs', '')
    if not logs:
        return jsonify({'root_causes': []})
    error_lines = [line for line in logs.split('\n') if 'error' in line.lower() or 'exception' in line.lower()]
    tokens = []
    for line in error_lines:
        tokens += word_tokenize(re.sub(r'[^a-zA-Z0-9 ]', '', line.lower()))
    common = Counter(tokens).most_common(5)
    root_causes = [w for w, _ in common if w not in ('error', 'exception', 'the', 'a', 'an', 'to', 'in', 'of', 'and')]
    return jsonify({'root_causes': root_causes, 'error_lines': error_lines})


@app.route('/health', methods=['GET'])
def health():
    total = count_all_samples()
    return jsonify({
        'status': 'ok',
        'persisted_samples': total,
        'if_models_cached': len(_if_cache),
        'rf_models_cached': len(_rf_cache),
    })


if __name__ == '__main__':
    nltk.download('punkt', quiet=True)
    init_db()
    print(f"[ML] DB: {DB_PATH}")
    app.run(host='0.0.0.0', port=8000)
