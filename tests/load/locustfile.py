from locust import User, task, between
from locust.exception import StopUser
import os
import subprocess
import uuid


class CreateStreamUser(User):
    """Locust user that invokes the `scripts/invoke_create.sh` helper once.

    Each virtual user will call the shell helper once and then stop. The
    script relies on the environment variables described in
    `scripts/invoke_create.sh` (VESTING_CONTRACT, SPONSOR, RECIPIENT, TOKEN,
    RATE, CLIFF_DURATION, TOTAL_DURATION). To avoid duplicate-schedule
    failures, tests should provide unique recipients or a pool of pre-funded
    accounts.
    """

    wait_time = between(0, 0)

    @task
    def create_once(self):
        env = os.environ.copy()

        # If RECIPIENT is not provided, generate a (placeholder) id to
        # encourage the test runner to provide unique recipients.
        if not env.get("RECIPIENT"):
            env["RECIPIENT"] = f"RECIPIENT-{uuid.uuid4().hex}"

        cmd = ["bash", "./scripts/invoke_create.sh"]

        proc = subprocess.run(cmd, env=env, capture_output=True, text=True)

        if proc.returncode == 0:
            self.environment.events.request_success.fire(request_type="cli", name="invoke_create", response_time=0, response_length=0)
        else:
            self.environment.events.request_failure.fire(request_type="cli", name="invoke_create", response_time=0, response_length=0, exception=proc.stderr)

        # Stop this virtual user after one attempt.
        raise StopUser()
