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

DB_PATH = '/tmp/argus_ml.db'
MODEL_PATH = '/tmp/argus_model.pkl'

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

def load_all_durations():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute('SELECT duration FROM build_history ORDER BY ts DESC LIMIT 500').fetchall()
    conn.close()
    return [r[0] for r in rows]

# ── Model persistence ─────────────────────────────────────────────────────────

def load_model():
    if os.path.exists(MODEL_PATH):
        with open(MODEL_PATH, 'rb') as f:
            return pickle.load(f)
    return None

def save_model(model):
    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)

def get_or_train_model(durations):
    model = load_model()
    all_durations = load_all_durations()
    combined = list(set(all_durations + list(durations)))

    if model is None or len(combined) > len(all_durations):
        # Retrain with all historical + new data
        X = np.array(combined).reshape(-1, 1)
        model = IsolationForest(contamination=0.1, random_state=42)
        model.fit(X)
        save_model(model)
        print(f"[ML] Model retrained on {len(combined)} samples")

    return model

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/analyze', methods=['POST'])
def analyze():
    print("[ML SERVICE] /analyze called")
    data = request.get_json()
    durations  = np.array(data.get('durations', []))
    statuses   = data.get('statuses', [])
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

        # Use persisted model for detection
        model = get_or_train_model(durations)
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
    history = data.get('history', [])
    if len(history) < 5:
        return jsonify({'prob_failure': 0.0, 'note': 'Not enough data'})
    df = pd.DataFrame(history)
    X = df[['duration']]
    y = df['status']
    clf = RandomForestClassifier(n_estimators=10, random_state=42)
    clf.fit(X, y)
    next_duration = np.mean(df['duration'])
    prob_failure = 1 - clf.predict_proba([[next_duration]])[0][1]
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
    all_dur = load_all_durations()
    model_exists = os.path.exists(MODEL_PATH)
    return jsonify({
        'status': 'ok',
        'persisted_samples': len(all_dur),
        'model_trained': model_exists
    })


if __name__ == '__main__':
    nltk.download('punkt', quiet=True)
    init_db()
    print(f"[ML] DB: {DB_PATH} | Model: {MODEL_PATH}")
    app.run(host='0.0.0.0', port=8000)
