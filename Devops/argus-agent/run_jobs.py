"""
Argus Agent — Job Runner
Executes the LLM-planned job scenarios directly against Jenkins.
Creates 5 jobs, runs 38 builds total with deliberate failures and anomalies.
"""
import time
import logging
import os
from jenkins_client import JenkinsClient
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    handlers=[
        logging.FileHandler("logs/run_jobs.log"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

jenkins = JenkinsClient(
    url=os.getenv("JENKINS_URL", "http://localhost:8080"),
    username=os.getenv("JENKINS_USER", "admin"),
    api_token=os.getenv("JENKINS_TOKEN", "")
)

def run(job, script, label=""):
    jenkins.create_job(job, script)
    time.sleep(2)
    jenkins.trigger_build(job)
    time.sleep(3)
    result = jenkins.wait_for_build(job)
    log.info(f"  [{label}] {job} → {result}")
    time.sleep(2)
    return result

def runs(job, script, n, label="SUCCESS"):
    """Run same script n times."""
    for i in range(n):
        jenkins.create_job(job, script)
        time.sleep(2)
        jenkins.trigger_build(job)
        time.sleep(3)
        result = jenkins.wait_for_build(job)
        log.info(f"  [{label} {i+1}/{n}] {job} → {result}")
        time.sleep(2)

# ─────────────────────────────────────────────────────────────
# Job 1: frontend-deploy  (8 builds — anomaly on run 5)
# ─────────────────────────────────────────────────────────────
log.info("\n========== frontend-deploy ==========")
SUCCESS_SCRIPT = """
echo "=== Frontend Deploy ==="
echo "Installing dependencies..."
sleep 3
echo "Running tests..."
sleep 2
echo "Building bundle..."
sleep 2
echo "Deploy complete."
"""
ANOMALY_SCRIPT = """
echo "=== Frontend Deploy ==="
echo "Installing dependencies..."
sleep 60
echo "Cache miss — full reinstall done."
sleep 2
echo "Deploy complete."
"""
runs("frontend-deploy", SUCCESS_SCRIPT, 4, "NORMAL")
run("frontend-deploy",  ANOMALY_SCRIPT, "ANOMALY-SLOW")
runs("frontend-deploy", SUCCESS_SCRIPT, 3, "RECOVERY")

# ─────────────────────────────────────────────────────────────
# Job 2: backend-api  (7 builds — fails on runs 5-6)
# ─────────────────────────────────────────────────────────────
log.info("\n========== backend-api ==========")
API_SUCCESS = """
echo "=== Backend API ==="
echo "Compiling source..."
sleep 4
echo "Running unit tests..."
sleep 3
echo "Packaging artifact..."
sleep 2
echo "Deploy successful."
"""
API_FAILURE = """
echo "=== Backend API ==="
echo "Compiling source..."
sleep 2
echo "ERROR: Database connection refused"
echo "FATAL: NullPointerException in ApplicationContext"
exit 1
"""
runs("backend-api", API_SUCCESS,  4, "NORMAL")
runs("backend-api", API_FAILURE,  2, "FAILURE")
runs("backend-api", API_SUCCESS,  1, "RECOVERY")

# ─────────────────────────────────────────────────────────────
# Job 3: ml-pipeline  (6 builds — all healthy)
# ─────────────────────────────────────────────────────────────
log.info("\n========== ml-pipeline ==========")
ML_SCRIPT = """
echo "=== ML Pipeline ==="
echo "Loading training data..."
sleep 3
echo "Training model..."
sleep 6
echo "Evaluating accuracy..."
sleep 2
echo "Model deployed."
"""
runs("ml-pipeline", ML_SCRIPT, 6, "HEALTHY")

# ─────────────────────────────────────────────────────────────
# Job 4: data-sync  (6 builds — fails on runs 4-5)
# ─────────────────────────────────────────────────────────────
log.info("\n========== data-sync ==========")
SYNC_SUCCESS = """
echo "=== Data Sync ==="
echo "Connecting to source..."
sleep 3
echo "Syncing records..."
sleep 3
echo "Sync complete."
"""
SYNC_FAILURE = """
echo "=== Data Sync ==="
echo "Connecting to source..."
sleep 2
echo "ERROR: Connection timeout after 30s"
echo "FATAL: Could not reach remote endpoint"
exit 1
"""
runs("data-sync", SYNC_SUCCESS, 3, "NORMAL")
runs("data-sync", SYNC_FAILURE, 2, "TIMEOUT-FAIL")
runs("data-sync", SYNC_SUCCESS, 1, "RECOVERY")

# ─────────────────────────────────────────────────────────────
# Job 5: infra-provision  (5 builds — getting progressively slower)
# ─────────────────────────────────────────────────────────────
log.info("\n========== infra-provision ==========")
for delay, label in [(5,"FAST"), (8,"NORMAL"), (12,"SLOW"), (18,"SLOWER"), (25,"DEGRADED")]:
    script = f"""
echo "=== Infra Provision ==="
echo "Provisioning infrastructure..."
sleep {delay}
echo "Done."
"""
    run("infra-provision", script, f"DRIFT-{delay}s")

log.info("\n========== ALL DONE ==========")
log.info("5 jobs created, 38 builds triggered.")
log.info("Open Argus Agent dashboard and click 'Test Connection' to see real data.")
