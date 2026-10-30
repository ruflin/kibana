# Nightshift

Owner: `@elastic/nightshift`

Browser-only plugin serving the Nightshift UI at `/app/nightshift`.

Nightshift surfaces significant events, their detections, the entities they touch and
the investigations opened against them. All data access goes through
`significantEventsRepositoryClient` from the `significant_events` start contract; this
plugin owns no server code and issues no bare HTTP requests.

`significant_events` is a **required** plugin, so wherever it is disabled — Search,
Security and Logs Essentials serverless projects, for instance — Nightshift is
cascade-disabled with it.

When the plugin does load, the app is gated on
`GET /internal/significant_events/availability` — the single source of truth for whether
Significant Events can run, aggregating the rollout flag
(`nightshift.enabled`), project type, pricing tier, license and required
plugins. When it reports unavailable the app is hidden from navigation and direct visits
redirect to the Observability overview.

## Seeding investigations for local development

`scripts/seed_nightshift_investigations.ts` fills the landing page with 14 investigations: every
severity, open and closed, investigations without findings yet, and alert, significant event,
question, and Slack thread subjects. Run it from the repo root against a running stack with
`agenticInvestigations`, `proposals`, and `nightshiftInvestigations` enabled:

```sh
node -r @kbn/setup-node-env x-pack/solutions/observability/plugins/nightshift/scripts/seed_nightshift_investigations.ts \
  --es-url http://localhost:9200 --kibana-url http://localhost:5601
```

Each scenario is written as a shared agentic investigation, the way a real run leaves it: an
Agent Builder conversation on the `investigation` template (agent `nightshift.investigation`,
public, owned by the `--auth` user) with its title and `status` / `severity` / `summary` /
`verdict` metadata; its subject, impact, and hypotheses documents in the agentic investigations
side indexes, attached to the conversation by reference; and its proposed actions, created through
the proposals gate workflow that `proposals.create` runs. Kibana APIs do the writes where a route
exists. The side-index documents and the conversation timestamps have none, so they are written to
Elasticsearch as `kibana_system` (`--kibana-system-auth`). No AI connector or investigation run is
needed.

The conversation ids are derived from the scenarios, so a re-run replaces the earlier seeds.
`--clean` only removes them. `--help` lists the connection flags.

## Seeding the demo for local development

`scripts/seed_nightshift_demo.ts` fills the knowledge, detection and sources pages with one story:
the claims pipeline (`claim-intake`, `policy-lookup`, `fraud-check`, `payment-processor`,
`notification-dispatch`, `postgres`) during a fraud-check timeout, with a Redis and Kafka red herring.
It writes the claims logs, a source over them, 15 knowledge indicators, two rules, two detections and
two events. No AI connector or inference call is needed.

Run it from the repo root against a local serverless Observability Complete stack (Nightshift is
enabled there through `serverless.oblt.complete.yml`):

```sh
node -r @kbn/setup-node-env x-pack/solutions/observability/plugins/nightshift/scripts/seed_nightshift_demo.ts
```

The script finds Elasticsearch on `localhost:9200` and Kibana on `localhost:5601`, trying HTTPS before
HTTP and the `elastic_serverless` user before `elastic`, the same way `scripts/kibana_api_common.sh`
does. A self-signed certificate is accepted for localhost only. Pass `--es-url`, `--kibana-url`,
`--es-username` or `--es-password` to skip detection for a service. If Nightshift is not enabled on the
target, the script stops before writing anything.

- It resumes Significant Events first, if a previous run paused it, and pauses it again after the
  rules are created. The real rules and workflows then do not act on the demo data. The
  paused-activity callout is expected; resume from the settings page when you are done.
- `--clean` removes the demo source with its queries, and the demo events and detections. Logs stay,
  because they are time-bounded.
- Re-running without `--clean` replaces the demo events and detections instead of duplicating them.
- `--live` raises one scripted event every 2 minutes until Ctrl+C.
- Elasticsearch must run with security enabled: the detection overview calls
  `_security/user/_has_privileges`, which does not exist without it.

Not covered yet: investigations, automations, onboarding suggestions, Cortex, Memory and decision trees.
Those pages stay empty after the seed.

## Turning `nightshift.enabled` off and on

Flipping `nightshift.enabled` from on to off at runtime pauses Significant Events in
every space, like the Pause action in its settings does for one space: each space's
scheduled workflows are disabled, in-flight executions are cancelled, and the continuous
onboarding and scheduled discovery toggles are turned off, with their previous values kept
for Resume. A space that a user already paused keeps its own record. The shared workflows
stay enabled. The alerting rules backing knowledge indicator queries are disabled as the
internal Kibana user. The maintenance state of each space records `system:feature_flag` as
who paused it. A flag value only counts once it has held for 15 seconds, so the value read
at startup, or a brief flip, never triggers a pause. If the spaces cannot be listed, nothing
is paused and the failure is logged; the next managed-workflow install re-applies the pause
only in spaces that are already paused.

Flipping it back on does not resume. After the managed workflows are reinstalled the pause
is re-asserted, and activity stays stopped until a user resumes it. While the flag is off,
`POST /internal/significant_events/maintenance/_pause` and
`GET /internal/significant_events/maintenance/_status` stay available (Resume does not), so
activity can still be stopped by hand.
