---
name: kibana-api
description: Shared utilities for interacting with a local Kibana instance. Provides auto-detection of Kibana URL and auth, and a kibana_curl wrapper.
user-invocable: false
---

# Kibana API Utilities

This skill provides shared shell utilities for other skills that need to call Kibana APIs.

## Usage

Source `scripts/kibana_api_common.sh` from any skill script:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
source "$REPO_ROOT/scripts/kibana_api_common.sh"
```

After sourcing, the following are available:

- **`KIBANA_URL`** — Detected base URL (e.g., `http://localhost:5601`)
- **`KIBANA_AUTH`** — Detected credentials (e.g., `elastic:changeme`)
- **`kibana_curl [curl args...]`** — curl wrapper with auth, `kbn-xsrf`, `x-elastic-internal-origin`, and TLS flags pre-configured

## Auto-Detection

Detection runs `node scripts/local_stack.js env` (`@kbn/local-stack-connection`), the same logic the
Node scripts use:
- URLs: `server.*` from `config/kibana.dev.yml`, then `http://localhost:5601` and `https://localhost:5601`
- The random dev base path is detected
- Auth: `elastic:changeme` (stateful), then `elastic_serverless:changeme` (serverless)
- Local https is verified against the Kibana dev CA (`curl --cacert`), not skipped with `-k`

Override with environment variables `KIBANA_URL` and/or `KIBANA_AUTH` (or `KIBANA_USERNAME` /
`KIBANA_PASSWORD` / `KIBANA_API_KEY`) before sourcing.

For Elasticsearch, or scripts that are not written in bash, evaluate the exports directly:

```bash
eval "$(node scripts/local_stack.js env --skip-kibana)"
curl -s ${LOCAL_STACK_CA_CERT:+--cacert "$LOCAL_STACK_CA_CERT"} \
  -u "$ELASTICSEARCH_USERNAME:$ELASTICSEARCH_PASSWORD" "$ELASTICSEARCH_HOST/_cluster/health"
```

## Session Auth (Acting as a Browser User)

By default, `kibana_curl` authenticates via HTTP Basic auth, which uses the `__http__` auth provider.
This is a different auth realm than the browser, which uses the `basic` provider. 
Any per-user state tied to a browser session (e.g. OAuth tokens, user-specific settings) will not be visible to API calls made with HTTP Basic auth.

To authenticate in the same auth realm as a browser user, set `KIBANA_USE_SESSION=true` before sourcing:

```bash
export KIBANA_USE_SESSION=true
REPO_ROOT="$(git rev-parse --show-toplevel)"
source "$REPO_ROOT/scripts/kibana_api_common.sh"
```

This logs in via the `basic` auth provider and uses a session cookie for all subsequent `kibana_curl` calls. 
The default behavior is unchanged when the variable is unset or `false`.
