#!/usr/bin/env bash
# Integration smoke tests — hits live endpoints after docker compose brings the stack up.
# Exit code 0 = all checks passed. Any failure exits immediately with code 1.
set -euo pipefail

ML="http://localhost:8000"
SB="http://localhost:8020"

pass=0
fail=0

check_get() {
  local desc="$1" url="$2" want="${3:-200}"
  local got
  got=$(curl -sf -o /dev/null -w "%{http_code}" "$url" || echo "000")
  if [[ "$got" == "$want" ]]; then
    echo "  PASS  $desc"
    (( pass++ )) || true
  else
    echo "  FAIL  $desc — expected HTTP $want, got $got"
    (( fail++ )) || true
  fi
}

check_post() {
  local desc="$1" url="$2" body="$3" want="${4:-200}"
  local got
  got=$(curl -sf -o /dev/null -w "%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "$body" "$url" || echo "000")
  if [[ "$got" == "$want" ]]; then
    echo "  PASS  $desc"
    (( pass++ )) || true
  else
    echo "  FAIL  $desc — expected HTTP $want, got $got"
    (( fail++ )) || true
  fi
}

echo ""
echo "── ML service ($ML) ──────────────────────────────"

check_get "GET /health" "$ML/health"

check_post "POST /analyze — valid payload" "$ML/analyze" \
  '{"job_name":"smoke","durations":[110,120,115,118,122],"statuses":["SUCCESS","SUCCESS","SUCCESS","SUCCESS","SUCCESS"],"latest_status":"SUCCESS","latest_duration":122}'

check_post "POST /analyze — missing durations returns 400" "$ML/analyze" \
  '{"job_name":"smoke"}' "400"

check_post "POST /predict-failure — insufficient data returns note" "$ML/predict-failure" \
  '{"job_name":"smoke-new"}'

echo ""
echo "── Spring Boot ($SB) ─────────────────────────────"

check_get "GET /actuator/health"     "$SB/actuator/health"
check_get "GET /actuator/prometheus" "$SB/actuator/prometheus"
check_get "GET /api/jobs"            "$SB/api/jobs"

echo ""
echo "─────────────────────────────────────────────────"
echo "  Results: $pass passed, $fail failed"
echo ""

if [[ $fail -gt 0 ]]; then
  exit 1
fi
