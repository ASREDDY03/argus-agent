import json
import time
import logging
import os
import requests
from jenkins_client import JenkinsClient
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
JENKINS_URL   = os.getenv("JENKINS_URL", "http://localhost:8080")
JENKINS_USER  = os.getenv("JENKINS_USER", "admin")
JENKINS_TOKEN = os.getenv("JENKINS_TOKEN", "")
OLLAMA_URL    = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL  = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:14b")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("logs/agent.log"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

# ── Ollama client ─────────────────────────────────────────────────────────────
def call_ollama(messages, tools):
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "tools": tools,
        "stream": False
    }
    resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=300)
    resp.raise_for_status()
    return resp.json()

# ── Jenkins tools exposed to the agent ───────────────────────────────────────
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_jenkins_job",
            "description": "Create a Jenkins freestyle job with a given shell script",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":   {"type": "string", "description": "Job name (no spaces)"},
                    "script": {"type": "string", "description": "Bash shell script the job will run"}
                },
                "required": ["name", "script"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_and_wait",
            "description": "Trigger a Jenkins job build and wait for it to complete",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Job name to trigger"}
                },
                "required": ["name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_job_script",
            "description": "Update an existing Jenkins job with a new shell script (used to switch between pass/fail scenarios)",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":   {"type": "string", "description": "Existing job name"},
                    "script": {"type": "string", "description": "New bash script"}
                },
                "required": ["name", "script"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "report_done",
            "description": "Call this when all jobs have been created and all builds triggered",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "Summary of what was created and run"}
                },
                "required": ["summary"]
            }
        }
    }
]

# ── Tool executor ─────────────────────────────────────────────────────────────
jenkins = JenkinsClient(JENKINS_URL, JENKINS_USER, JENKINS_TOKEN)

def execute_tool(name, args):
    if name == "create_jenkins_job":
        ok = jenkins.create_job(args["name"], args["script"])
        return {"status": "created" if ok else "failed", "job": args["name"]}

    elif name == "update_job_script":
        ok = jenkins.create_job(args["name"], args["script"])
        return {"status": "updated" if ok else "failed", "job": args["name"]}

    elif name == "trigger_and_wait":
        triggered = jenkins.trigger_build(args["name"])
        if not triggered:
            return {"status": "trigger_failed", "job": args["name"]}
        time.sleep(3)
        result = jenkins.wait_for_build(args["name"])
        return {"status": "completed", "job": args["name"], "result": result}

    elif name == "report_done":
        log.info(f"\n{'='*60}\nAGENT DONE\n{args['summary']}\n{'='*60}")
        return {"status": "done"}

    return {"error": f"Unknown tool: {name}"}

# ── Agent loop ────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are Argus Agent — a DevOps automation agent.

Your job is to create Jenkins CI/CD jobs and run them multiple times to build up realistic build history for an ML anomaly detection system.

You have access to tools to create jobs, trigger builds, and update job scripts.

Create exactly these 5 jobs and run them as specified:

1. frontend-deploy (8 builds)
   - Runs 1-6: success script (npm install simulation, sleep 3-5s)
   - Run 7: anomaly — add sleep 60 to simulate a very slow build
   - Run 8: back to normal success

2. backend-api (7 builds)
   - Runs 1-4: success script (compile + test simulation, sleep 4-6s)
   - Runs 5-6: failure script (exit 1 with error messages)
   - Run 7: success again (recovery)

3. ml-pipeline (6 builds)
   - All success, consistent sleep 8-10s each time

4. data-sync (6 builds)
   - Runs 1-3: success (sleep 3-4s)
   - Runs 4-5: failure (timeout simulation, exit 1)
   - Run 6: success

5. infra-provision (5 builds)
   - All success but getting progressively slower: sleep 5, 8, 12, 18, 25

Use update_job_script to swap scripts between pass/fail runs.
Wait for each build to complete before triggering the next one.
Call report_done when all 38 builds are finished.

Start now."""

def run_agent():
    log.info("Argus Agent starting...")
    log.info(f"Jenkins: {JENKINS_URL} | Model: {OLLAMA_MODEL}")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.append({"role": "user", "content": "Create all Jenkins jobs and run all builds now."})

    iteration = 0
    max_iterations = 120

    while iteration < max_iterations:
        iteration += 1
        log.info(f"\n--- Agent iteration {iteration} ---")

        response = call_ollama(messages, TOOLS)
        msg = response.get("message", {})
        tool_calls = msg.get("tool_calls", [])
        content = msg.get("content", "")

        messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls if tool_calls else None})

        # qwen2.5-coder returns tool calls as text — parse and execute them
        if not tool_calls and content:
            import re
            # Strip markdown code fences then find JSON objects
            clean = re.sub(r'```(?:json)?\s*', '', content)
            clean = re.sub(r'```', '', clean)
            blocks = re.findall(r'(\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\})', clean, re.DOTALL)
            if blocks:
                log.info(f"Parsing {len(blocks)} tool calls from model text output")
                for block in blocks:
                    try:
                        call = json.loads(block)
                        fn_name = call.get("name")
                        fn_args = call.get("arguments", {})
                        if not fn_name:
                            continue
                        log.info(f"Tool: {fn_name}({list(fn_args.keys())})")
                        result = execute_tool(fn_name, fn_args)
                        log.info(f"Result: {result}")
                        if fn_name == "report_done":
                            log.info("Agent completed all tasks.")
                            return
                    except Exception as e:
                        log.warning(f"Could not parse tool call block: {e}")
                break
            else:
                log.info(f"Agent response: {content}")
                break

        for tool_call in tool_calls:
            fn_name = tool_call["function"]["name"]
            fn_args = tool_call["function"].get("arguments", {})
            if isinstance(fn_args, str):
                fn_args = json.loads(fn_args)

            log.info(f"Tool: {fn_name}({list(fn_args.keys())})")
            result = execute_tool(fn_name, fn_args)
            log.info(f"Result: {result}")

            messages.append({
                "role": "tool",
                "content": json.dumps(result)
            })

            if fn_name == "report_done":
                log.info("Agent completed all tasks.")
                return

    log.info("Agent loop ended.")

if __name__ == "__main__":
    run_agent()
