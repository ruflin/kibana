---
name: nightshift-local-sandbox
description: >
  Set up a local sandbox (sandbox-service on minikube) for a local Kibana so Nightshift
  investigations and other `xpack.sandbox` features work in dev. Use when asked to set up,
  start, repair or tear down the local sandbox, or when Kibana logs that `xpack.sandbox` is
  disabled, the sandbox is unreachable, or `api_key` is missing.
allowed-tools: Bash, Read, Edit
---

# Local sandbox for Nightshift development

Gets a working `xpack.sandbox` behind a local Kibana by running `elastic/sandbox-service` on a
local minikube. The authoritative how-to lives in the sandbox-service repo
(`docs/kibana-local.md`, `docs/minikube.md`). This skill is the runbook an agent follows, with the
checks and stop points that matter.

## Rules

- **Never print, log, or commit a credential.** That covers the sandbox dev credential, the
  Elasticsearch password, and any API key. Read them into a shell variable or write them to a
  git-ignored file, and show only that they were set.
- **Never guess passwords** for Elasticsearch or anything else, and never read another
  container's environment to find one. Ask the user (see [Stop and ask](#stop-and-ask)).
- `config/kibana.dev.yml` is git-ignored. Edit it in place and keep the user's other settings.
- Deleting the minikube profile is part of the documented repair path, but tell the user first:
  it regenerates the dev credential.

## 1. Pick the option

| | Local minikube (this skill) | Shared eval cluster |
|---|---|---|
| Needs | minikube, kubectl, Docker, a clone of sandbox-service | A dev credential from `@elastic/nightshift-investigations-team` |
| Sandbox reaches your local Elasticsearch | Yes, as `host.minikube.internal` | No, only public endpoints |
| Cost | Runs a minikube node on your machine | None |

If the user has no need to reach a local Elasticsearch and already holds an eval credential, the
eval cluster is simpler: set `xpack.sandbox.host: eval-sandbox-api.elastic-observability-ocp.elastic.dev`,
`port: 9090` and `api_key: ${SANDBOX_API_KEY}`, with no `ssl` block, and skip to step 5. Otherwise
continue with minikube.

## 2. Check prerequisites

```bash
for t in minikube kubectl docker openssl python3 grpcurl; do printf '%s: ' $t; command -v $t || echo MISSING; done
minikube version --short   # needs 1.39 or newer
docker info >/dev/null 2>&1 && echo "docker: up" || echo "docker: DOWN"
```

- Missing tools: install them (`brew install minikube kubectl grpcurl` on macOS). `grpcurl` is only
  needed for the verification step. If Docker is down, ask the user to start it.
- Docker Desktop must have room for the node (the script asks for 8 CPUs and 24 GiB of memory on a
  new profile). If minikube refuses for memory, ask the user to raise Docker's limit, or set
  `MINIKUBE_MEMORY` and `MINIKUBE_CPUS` before the first start.
- Find or clone the sandbox-service repo. Look for a sibling checkout first
  (`../sandbox-service`); otherwise clone it next to Kibana. It is a private Elastic repo, so
  the user needs access:

```bash
[ -d ../sandbox-service ] || git clone git@github.com:elastic/sandbox-service.git ../sandbox-service
git -C ../sandbox-service pull --ff-only
```

## 3. Deploy

```bash
cd ../sandbox-service && ./scripts/minikube-deploy.sh
```

The first run builds five images and downloads gVisor (about 120 MB), so it can take ten minutes
or more. Run it with a long timeout or in the background, and wait for
`sandbox-service is up on minikube profile sandbox-service`.

If it fails:

- `K8S_APISERVER_MISSING` after a long wait, preceded by "container is missing, will recreate":
  the profile outlived its node container. Tell the user, run
  `./scripts/minikube-deploy.sh delete`, then deploy again. Newer sandbox-service checkouts do
  this automatically.
- "Docker is nearly out of disk space": tell the user. They can free space with
  `docker system prune`. The deploy often still works.
- Anything else: see the Troubleshooting table in sandbox-service `docs/kibana-local.md` before
  improvising.

## 4. Port-forward and verify

Start the forwarder in the background and leave it running, since Kibana needs it:

```bash
nohup kubectl --context sandbox-service port-forward svc/sandbox-api 9090:9090 >/dev/null 2>&1 &
sleep 3 && lsof -nP -iTCP:9090 -sTCP:LISTEN | tail -1
```

Then verify (this reuses a running forwarder on newer checkouts; on older ones it kills and
replaces it, so restart the forwarder afterwards):

```bash
cd ../sandbox-service && ./scripts/minikube-deploy.sh test
```

Both round trips (`RunCommand` and the credential proxy) must report success.

## 5. Configure Kibana

The credential changes whenever the profile is deleted, so keep it in the environment, not in the
YAML file:

```bash
export SANDBOX_API_KEY="$(../sandbox-service/scripts/minikube-deploy.sh credential)"
```

On an older sandbox-service checkout without a `credential` subcommand, build the same value
without printing it:

```bash
export SANDBOX_API_KEY="$(kubectl --context sandbox-service get secret sandbox-dev-credentials \
  -o jsonpath='{.data.credentials}' | base64 --decode \
  | /usr/bin/python3 -c 'import json,sys; u,p = next(iter(json.load(sys.stdin).items())); print(f"{u}:{p}")')"
```

Add or update this block in `config/kibana.dev.yml`. Use the absolute path of the user's home for
the CA, because Kibana does not expand `~`:

```yaml
xpack.sandbox:
  enabled: true
  host: localhost
  port: 9090
  api_key: ${SANDBOX_API_KEY}
  ssl:
    certificate_authorities: <home>/.sandbox-minikube/ca.crt
```

- Do not set `ssl.certificate` or `ssl.key`. A client certificate takes precedence over the dev
  credential and makes every call fail.
- If the file already has an `xpack.sandbox` block with a literal `api_key`, replace it with
  `${SANDBOX_API_KEY}`.
- Kibana fails to start if `SANDBOX_API_KEY` is unset, so it must be exported in the shell that
  starts Kibana.

Nightshift also needs these in the same file (check what is already there first):

```yaml
feature_flags.overrides:
  nightshift.enabled: true
xpack.nightshift_investigations.enabled: true
xpack.agenticInvestigations.enabled: true
xpack.proposals.enabled: true
```

## 6. Telemetry connector (only if the sandbox must query local Elasticsearch)

Nightshift Investigator queries Elasticsearch through a preconfigured webhook connector, not by
guessing a URL. Without `telemetry_connector_id` the investigator is told no telemetry connector is
available. This step needs an API key on the user's local Elasticsearch:

1. Ask the user for an **encoded API key** for their local Elasticsearch, or ask them to run the
   command below and export `NIGHTSHIFT_LOCAL_ES_KEY` in the Kibana shell. Do not ask for, find, or
   try passwords yourself.

   ```bash
   curl -sk -u elastic -H 'Content-Type: application/json' \
     https://localhost:9200/_security/api_key -d '{"name":"nightshift-local-telemetry"}'
   ```

   (Use `http://` if the cluster has no TLS. The key is the `encoded` field of the response.)

2. Add to `config/kibana.dev.yml`, using the scheme and port of the user's Elasticsearch:

   ```yaml
   xpack.nightshift_investigations.sandbox.telemetry_connector_id: nightshift-local-telemetry

   xpack.actions.preconfigured:
     nightshift-local-telemetry:
       name: 'Local Elasticsearch telemetry'
       actionTypeId: .webhook
       config:
         url: http://host.minikube.internal:9200
         method: post
         hasAuth: true
       secrets:
         user: api_key
         password: ${NIGHTSHIFT_LOCAL_ES_KEY}
   ```

   If the cluster serves HTTPS with a self-signed certificate, the sandbox may not trust it. That
   case is unverified: say so to the user rather than guessing.

## 7. Start Kibana

In the shell where `SANDBOX_API_KEY` (and `NIGHTSHIFT_LOCAL_ES_KEY`, if used) are exported:

```bash
node scripts/kibana --dev
```

Starting Kibana is the user's call: it is long-running and needs a running Elasticsearch. If asked
to start it, run it in the background and report where its logs are. A sandbox log line such as
`xpack.sandbox.enabled is true but api_key is not configured` means the variable was not exported in
that shell.

## Stop and ask

Stop and ask the user, instead of continuing, when:

- Docker is not running or Docker Desktop's limits are too low.
- You lack access to clone `elastic/sandbox-service`.
- The deploy needs `minikube delete` of an existing profile (it regenerates the credential).
- Step 6 needs Elasticsearch credentials you do not have.
- A step fails in a way the sandbox-service Troubleshooting table does not cover.

## Update, pause and remove

```bash
cd ../sandbox-service
git pull && ./scripts/minikube-deploy.sh         # rebuild and redeploy; keeps the credential
minikube stop -p sandbox-service                 # pause; frees CPU and memory
minikube start -p sandbox-service                # resume, then restart the port-forward
./scripts/minikube-deploy.sh delete              # remove the profile; the credential changes
```

After a `delete` and redeploy, export `SANDBOX_API_KEY` again and restart Kibana.

## Report

End by telling the user what was done, what was not (for example "Kibana not started", "telemetry
connector not configured"), anything that could not be verified, and which option was chosen.
