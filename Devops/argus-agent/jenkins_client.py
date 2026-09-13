import requests
import time
import json
from requests.auth import HTTPBasicAuth

class JenkinsClient:
    def __init__(self, url, username, api_token):
        self.url = url.rstrip('/')
        self.auth = HTTPBasicAuth(username, api_token)
        self.session = requests.Session()
        self.session.auth = self.auth
        self._crumb = None

    def _get_crumb(self):
        resp = self.session.get(f"{self.url}/crumbIssuer/api/json")
        resp.raise_for_status()
        data = resp.json()
        self._crumb = {data['crumbRequestField']: data['crumb']}
        return self._crumb

    def _headers(self):
        crumb = self._get_crumb()
        return {**crumb, 'Content-Type': 'application/xml'}

    def job_exists(self, name):
        resp = self.session.get(f"{self.url}/job/{name}/api/json")
        return resp.status_code == 200

    def delete_job(self, name):
        if self.job_exists(name):
            resp = self.session.post(f"{self.url}/job/{name}/doDelete", headers=self._get_crumb())
            print(f"  [DELETE] {name} → {resp.status_code}")

    def create_job(self, name, script):
        self.delete_job(name)
        xml = f"""<?xml version='1.1' encoding='UTF-8'?>
<project>
  <description>Argus Agent managed job: {name}</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <scm class="hudson.scm.NullSCM"/>
  <canRoam>true</canRoam>
  <disabled>false</disabled>
  <blockBuildWhenDownstreamBuilding>false</blockBuildWhenDownstreamBuilding>
  <blockBuildWhenUpstreamBuilding>false</blockBuildWhenUpstreamBuilding>
  <triggers/>
  <concurrentBuild>false</concurrentBuild>
  <builders>
    <hudson.tasks.Shell>
      <command>{script}</command>
    </hudson.tasks.Shell>
  </builders>
  <publishers/>
  <buildWrappers/>
</project>"""
        resp = self.session.post(
            f"{self.url}/createItem?name={name}",
            data=xml,
            headers=self._headers()
        )
        success = resp.status_code in (200, 201)
        print(f"  [CREATE] {name} → {'OK' if success else f'FAILED ({resp.status_code})'}")
        return success

    def trigger_build(self, name):
        resp = self.session.post(
            f"{self.url}/job/{name}/build",
            headers=self._get_crumb()
        )
        success = resp.status_code in (200, 201)
        print(f"  [TRIGGER] {name} → {'queued' if success else f'FAILED ({resp.status_code})'}")
        return success

    def wait_for_build(self, name, timeout=120):
        print(f"  [WAIT] {name} building", end='', flush=True)
        start = time.time()
        while time.time() - start < timeout:
            time.sleep(5)
            print('.', end='', flush=True)
            resp = self.session.get(f"{self.url}/job/{name}/lastBuild/api/json")
            if resp.status_code != 200:
                continue
            data = resp.json()
            if not data.get('building', True) and data.get('result'):
                print(f" → {data['result']} ({data['duration']//1000}s)")
                return data['result']
        print(" → TIMEOUT")
        return "TIMEOUT"

    def get_all_jobs(self):
        resp = self.session.get(f"{self.url}/api/json")
        resp.raise_for_status()
        return [j['name'] for j in resp.json().get('jobs', [])]
