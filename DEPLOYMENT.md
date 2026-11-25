# Deployment guide

## Included configuration

`Dockerfile` builds a dependency-free Node image, runs as the unprivileged `node` user, and listens on the platform-provided `PORT` at `0.0.0.0`. `render.yaml` defines a Render Docker web service and checks `/api/health`. The service is configured for one instance because browser sessions and simulation state live in process memory. The container and Blueprint files are prepared locally; nothing has been built in a cloud account or published.

## Create a public GitHub repository

1. Review the repository contents, run tests, and inspect the files you intend to make public. Keep the raw Codex JSONL session log outside the repository; it is not an application artifact and may contain private conversation or machine details.
2. On GitHub, create a new **public** repository. Leave the options to add a README, `.gitignore`, or license unchecked so GitHub does not create an unrelated initial commit.
3. After you decide the repository name and owner, run these commands from this project directory, replacing the placeholders:

   ```powershell
   git remote add origin https://github.com/<OWNER>/<REPOSITORY>.git
   git push -u origin master
   ```

   These commands are instructions only. No remote has been added and nothing has been pushed. Inspect `git remote -v` and `git status` before pushing. If you want me to publish, provide the exact repository URL and explicit approval in a later instruction.

## Deploy with Render

1. First publish the reviewed repository yourself, or explicitly authorize publication.
2. In Render, create a new Blueprint and connect the GitHub repository. Render reads the root `render.yaml`; review the proposed web service and deploy it.
3. After deployment, open the generated `onrender.com` URL and check that the app loads, `/api/health` returns `{"status":"ok"...}`, and a simulation plus controller comparison run in the browser.
4. Keep a single instance. The session cookie routes only to a session in the process that created it; a restart clears session state. The current app has no persistent volume, database, or cross-instance session store.

Render Blueprints are configured from a `render.yaml` in the connected repository, and `healthCheckPath` enables an HTTP health check. See the [Blueprint YAML reference](https://render.com/docs/blueprint-spec) and [health check documentation](https://render.com/docs/health-checks).

## Local container check

If Docker is installed:

```powershell
docker build -t flow-state-traffic-lab .
docker run --rm -p 4173:4173 -e PORT=4173 flow-state-traffic-lab
```

Then visit <http://127.0.0.1:4173>. A successful local test does not replace a deployment smoke check after publishing.
