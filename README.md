<div align="center">

# Argus Agent

### AI-powered DevOps monitoring that watches your Jenkins pipelines, detects anomalies with ML, and explains failures in plain English using a local LLM.

[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.2-6DB33F?style=flat-square&logo=springboot&logoColor=white)](https://spring.io/projects/spring-boot)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org)
[![Python](https://img.shields.io/badge/Python-3.10-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/compose)
[![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?style=flat-square&logo=prometheus&logoColor=white)](https://prometheus.io)
[![Grafana](https://img.shields.io/badge/Grafana-F46800?style=flat-square&logo=grafana&logoColor=white)](https://grafana.com)
[![Ollama](https://img.shields.io/badge/Ollama-Local%20LLM-black?style=flat-square)](https://ollama.com)
[![Jenkins](https://img.shields.io/badge/Jenkins-D24939?style=flat-square&logo=jenkins&logoColor=white)](https://jenkins.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

</div>

---

## Screenshots

> Screenshots coming soon — UI polish in progress.

| Jenkins Jobs Dashboard | Job Insights + LLM Analysis |
|---|---|
| _(coming soon)_ | _(coming soon)_ |

| Grafana — Jenkins Pipelines | Grafana — Argus Overview |
|---|---|
| _(coming soon)_ | _(coming soon)_ |

---

## What it does

You connect Argus Agent to any Jenkins instance. It continuously polls your pipelines, runs build history through an **Isolation Forest** ML model to detect duration anomalies, and asks a **local Ollama LLM** to write a plain-English explanation of what went wrong and what to do next. Every finding lands in a Grafana dashboard and a Slack alert — no cloud APIs, no API keys, no data leaving your machine.

---

## Architecture

```
  GitHub Push
      │
      ▼
  GitHub Actions  ──────────────────────────────────────────────┐
  (trigger-jenkins.yml)                                          │ cloudflared tunnel
                                                                 ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │                              Docker Network (devopsnet)                      │
  │                                                                             │
  │  ┌──────────┐   REST    ┌────────────────┐   /analyze   ┌──────────────┐   │
  │  │  React   │◄────────►│  Spring Boot   │─────────────►│  ML Service  │   │
  │  │ Frontend │           │  Backend       │              │  (Flask)     │   │
  │  │ :3000    │           │  :8020         │◄─────────────│              │   │
  │  └──────────┘           │                │   anomalies  │  IsoForest   │   │
  │       ▲                 │  ┌──────────┐  │              │  + SQLite    │   │
  │       │                 │  │  MySQL   │  │              └──────────────┘   │
  │  ┌──────────┐           │  │  :3306   │  │                                 │
  │  │  Nginx   │           │  └──────────┘  │  /api/generate                 │
  │  │  :80/443 │           │                │─────────────►  Ollama           │
  │  └──────────┘           └───────┬────────┘              (host machine)     │
  │                                 │  /prometheus            qwen2.5-coder:14b│
  │                                 ▼                                          │
  │                         ┌──────────────┐                                   │
  │                         │  Prometheus  │                                   │
  │                         │  :9090       │                                   │
  │                         └──────┬───────┘                                   │
  │                                │                                           │
  │                    ┌───────────┴──────────┐                                │
  │                    ▼                      ▼                                │
  │             ┌──────────────┐    ┌──────────────────┐                       │
  │             │   Grafana    │    │   Alertmanager   │──► Slack #monitoring  │
  │             │   :3001      │    │   :9093          │                       │
  │             └──────────────┘    └──────────────────┘                       │
  │                                                                             │
  └─────────────────────────────────────────────────────────────────────────────┘
                                          ▲
                              Jenkins :8080 (host machine)
                              Prometheus plugin → /prometheus/
```

**Data flow for each pipeline build:**

1. Jenkins runs a build (triggered by GitHub Actions or manually)
2. Spring Boot polls Jenkins REST API → fetches full build history (up to 10 builds per job)
3. Build history (durations + statuses) sent to ML Service → Isolation Forest scores each build
4. Failure builds + statistical outliers (z-score > 2) flagged as anomalies
5. Spring Boot calls Ollama with job context → LLM returns root cause + recommendations
6. All metrics exposed at `/actuator/prometheus` → scraped by Prometheus
7. Grafana dashboards auto-refresh every 30s
8. Alertmanager fires Slack message on any `FAILURE` build

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 18, Bootstrap | Real-time job table, Grafana iframe tab |
| API | Spring Boot 3.2, Java | Jenkins REST integration, ML + LLM orchestration |
| Database | MySQL 8 | Job/employee persistence |
| ML Service | Python, Flask, scikit-learn | Isolation Forest anomaly detection |
| ML Persistence | SQLite + pickle | Model survives container restarts; learns across builds |
| LLM | Ollama (`qwen2.5-coder:14b`) | 100% local — no API keys, no data leaves your machine |
| CI Trigger | Jenkins + GitHub Actions | Webhooks via cloudflared tunnel |
| Metrics | Prometheus, Spring Actuator | Build durations, anomaly counts, JVM stats |
| Dashboards | Grafana (auto-provisioned) | Jenkins pipeline view + Spring Boot overview |
| Alerting | Alertmanager → Slack | Instant failure notifications |
| Ingress | Nginx | Reverse proxy for all services |
| Orchestration | Docker Compose | One command brings up the entire stack |

---

## Features

### ML Anomaly Detection
- **Isolation Forest** trained on rolling build history (last 500 builds per job, persisted in SQLite)
- Model pickled to disk — survives container restarts and gets smarter over time
- Also applies **z-score > 2** statistical check as a second pass
- Always flags `FAILURE` builds regardless of duration patterns

### Local LLM Insights
- Sends job name, status, duration, and anomaly flag to **Ollama** running on the host
- Uses `qwen2.5-coder:14b` by default — swap any Ollama model via `OLLAMA_MODEL` env var
- Returns plain-English root cause and actionable next steps — no hallucinated API calls

### GitHub Actions → Jenkins Integration
- Every repo gets a `trigger-jenkins.yml` workflow that POSTs to Jenkins on push
- Jenkins URL is a **cloudflared tunnel** (free, no port forwarding needed)
- `argus-tunnel.sh` refreshes the tunnel URL and updates the `JENKINS_URL` secret on all linked repos in one command, then auto-retriggers all pipelines via `workflow_dispatch`

### Grafana Monitoring Tab
- React dashboard includes a **Monitoring tab** that embeds Grafana panels inline
- Two auto-provisioned dashboards: Jenkins Pipelines + Argus Overview (Spring Boot JVM, HTTP rate, p99 latency)
- Grafana and Prometheus configs are version-controlled — dashboards load on first `docker compose up`

### Slack Alerts
- Alertmanager fires on any `FAILURE` build rule defined in `alert.rules.yml`
- Configure webhook in `alertmanager.yml`

---

## Quick Start

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Docker + Docker Compose | Latest | Required |
| Jenkins | Any | Can run locally on port 8080 |
| Ollama | Latest | `ollama pull qwen2.5-coder:14b` |
| `gh` CLI | Latest | Only needed for `argus-tunnel.sh` |
| `cloudflared` | Latest | Only needed to expose Jenkins to GitHub Actions |

### 1. Clone

```bash
git clone https://github.com/ASREDDY03/argus-agent.git
cd argus-agent/Devops
```

### 2. Configure environment

Create a `.env` file in `Devops/`:

```env
MYSQL_ROOT_PASSWORD=argus2024
MYSQL_DATABASE=argusdb
SPRING_DATASOURCE_USERNAME=root
SPRING_DATASOURCE_PASSWORD=argus2024
JENKINS_USER=your-jenkins-username
JENKINS_TOKEN=your-jenkins-api-token
```

Get your Jenkins API token: **Jenkins → your username → Configure → API Token → Generate**.

### 3. Configure Slack alerts (optional)

Edit `Devops/alertmanager.yml`:

```yaml
receivers:
  - name: 'slack-notifications'
    slack_configs:
      - api_url: 'YOUR_SLACK_WEBHOOK_URL'
        channel: '#monitoring'
```

### 4. Start Ollama

```bash
ollama pull qwen2.5-coder:14b
ollama serve   # runs on localhost:11434
```

### 5. Start the stack

```bash
cd Devops
docker compose up --build
```

First build takes ~3–5 minutes (Maven + npm). Subsequent starts are fast.

### 6. Access services

| Service | URL | Credentials |
|---|---|---|
| Argus Frontend | http://localhost | — |
| Grafana | http://localhost:3001 | admin / argus2024 |
| Prometheus | http://localhost:9090 | — |
| Alertmanager | http://localhost:9093 | — |
| Jenkins | http://localhost:8080 | your credentials |

---

## Connecting Jenkins to GitHub Actions

This lets any GitHub push trigger a Jenkins build automatically via a cloudflared tunnel — no port forwarding or static IP needed.

### 1. Start the tunnel

```bash
chmod +x ~/argus-tunnel.sh
~/argus-tunnel.sh
```

This script:
- Starts a `cloudflared` tunnel pointed at `localhost:8080`
- Extracts the public HTTPS URL
- Updates the `JENKINS_URL` GitHub Actions secret on all configured repos
- Triggers a `workflow_dispatch` on every repo so pipelines pick up the new URL

Re-run it any time your machine restarts or the tunnel expires.

### 2. Add GitHub Actions secrets to your repo

| Secret | Value |
|---|---|
| `JENKINS_URL` | Set automatically by `argus-tunnel.sh` |
| `JENKINS_USER` | Your Jenkins username |
| `JENKINS_TOKEN` | Your Jenkins API token |
| `JENKINS_JOB_NAME` | The Jenkins job name to trigger |

### 3. Add the workflow to your repo

Create `.github/workflows/trigger-jenkins.yml`:

```yaml
name: Trigger Jenkins Build
on:
  push:
    branches: [main]

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Jenkins
        run: |
          CRUMB=$(curl -s -u "${{ secrets.JENKINS_USER }}:${{ secrets.JENKINS_TOKEN }}" \
            "${{ secrets.JENKINS_URL }}/crumbIssuer/api/json" | \
            python3 -c "import sys,json; d=json.load(sys.stdin); print(d['crumb'])")
          curl -s -X POST \
            -u "${{ secrets.JENKINS_USER }}:${{ secrets.JENKINS_TOKEN }}" \
            -H "Jenkins-Crumb: $CRUMB" \
            "${{ secrets.JENKINS_URL }}/job/${{ secrets.JENKINS_JOB_NAME }}/build"
          echo "Build triggered."
```

---

## API Reference

All endpoints are served by Spring Boot on port 8020 (or via Nginx at `/api/*`).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/jobs` | List all Jenkins jobs with last build status |
| `GET` | `/api/jobs/{name}` | Full build history + ML anomaly detection + LLM insight |
| `GET` | `/api/jobs/{name}/summary` | Latest build metrics (duration, queue wait, cause) |
| `POST` | `/api/jobs/poll` | Force-poll Jenkins and refresh job list |
| `GET` | `/api/jenkins/config` | Get current Jenkins connection config |
| `POST` | `/api/jenkins/config` | Update Jenkins URL/user/token at runtime |
| `GET` | `/actuator/prometheus` | Prometheus metrics endpoint |
| `GET` | `http://localhost:8000/health` | ML service status + sample count + model state |

### ML Service endpoints (port 8000)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/analyze` | Detect anomalies in build history |
| `POST` | `/predict-failure` | Failure probability for next build |
| `POST` | `/analyze-logs` | NLP root cause extraction from log text |
| `GET` | `/health` | Service health + persisted sample count |

---

## Project Structure

```
argus-agent/
├── Devops/
│   ├── docker-compose.yml          # Full stack definition
│   ├── prometheus.yml              # Scrape configs (Spring Boot + Jenkins)
│   ├── alert.rules.yml             # Alerting rules
│   ├── alertmanager.yml            # Slack webhook config
│   │
│   ├── ml-service/
│   │   ├── app.py                  # Flask API — anomaly detection, log analysis
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   │
│   ├── springboot-backend/
│   │   └── src/main/java/.../
│   │       ├── controllers/
│   │       │   └── JenkinsController.java   # REST API
│   │       └── services/
│   │           └── JenkinsService.java      # Jenkins poll, ML call, Ollama LLM
│   │
│   ├── react-frontend/
│   │   └── src/
│   │       ├── components/
│   │       │   └── JenkinsDashboardComponent.jsx  # Jobs table + Monitoring tab
│   │       └── services/
│   │           └── JenkinsService.js
│   │
│   ├── grafana/
│   │   ├── provisioning/           # Auto-loaded on startup
│   │   │   ├── datasources/prometheus.yml
│   │   │   └── dashboards/default.yml
│   │   └── dashboards/
│   │       ├── jenkins-pipelines.json   # Build stats, duration, executor usage
│   │       └── argus-overview.json      # Spring Boot JVM, HTTP rate, latency
│   │
│   └── nginx/nginx.conf            # Reverse proxy
│
└── README.md
```

---

## Monitoring Dashboards

### Jenkins Pipelines Dashboard
- Total / Successful / Failed build counts (stat panels)
- Build duration per job (horizontal bar gauge — green/yellow/red thresholds)
- Build result table (all jobs at a glance)
- Duration trend over time (timeseries)
- Executor usage (in-use vs total)
- Jenkins JVM heap usage

### Argus Overview Dashboard
- Spring Boot JVM heap usage
- HTTP request rate (req/s)
- CPU usage gauge
- p99 response time (ms)

All dashboards auto-provision from `Devops/grafana/` — no manual Grafana configuration needed.

---

## How the ML model learns

```
First run (< 3 builds):   no model — only FAILURE flag applied
3+ builds:                Isolation Forest trained on all durations
                          model pickled to /tmp/argus_model.pkl
Container restart:        model loaded from pickle → no retraining needed
New builds arrive:        if new data expands the training set → retrain
500+ builds stored:       sliding window, oldest dropped
```

The model becomes more accurate over time as it accumulates build history across restarts.

---

## Configuration Reference

| Environment Variable | Default | Description |
|---|---|---|
| `JENKINS_URL` | `http://host.docker.internal:8080` | Jenkins base URL |
| `JENKINS_USER` | — | Jenkins username |
| `JENKINS_TOKEN` | — | Jenkins API token |
| `ML_SERVICE_URL` | `http://ml-service:8000/analyze` | ML service endpoint |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Ollama base URL |
| `OLLAMA_MODEL` | `qwen2.5-coder:14b` | Ollama model name |
| `SPRING_DATASOURCE_URL` | — | MySQL JDBC URL |
| `GF_SECURITY_ADMIN_PASSWORD` | `argus2024` | Grafana admin password |

---

## Troubleshooting

**Spring Boot returns 401 from Jenkins**
→ Check `JENKINS_USER` and `JENKINS_TOKEN` env vars in `docker-compose.yml`. Regenerate the API token in Jenkins if needed.

**ML service returns empty anomalies**
→ Need at least 3 builds. The `/health` endpoint shows `persisted_samples` count.

**Grafana shows "No data"**
→ Prometheus must be scraping successfully. Check `http://localhost:9090/targets` — both `spring-boot` and `jenkins` should be green.

**Ollama insight is empty**
→ Verify `ollama serve` is running on the host. Test with `curl http://localhost:11434/api/generate -d '{"model":"qwen2.5-coder:14b","prompt":"hello","stream":false}'`.

**Tunnel URL expired**
→ Run `~/argus-tunnel.sh` — it restarts the tunnel, updates all repo secrets, and retriggers all pipelines.

**Jenkins container exited after restart**
→ `docker start jenkins` (Jenkins persists state in a named volume).

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes
4. Open a pull request

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

Built by [Santhosh Reddy](https://github.com/ASREDDY03)

</div>
