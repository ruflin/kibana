# SigEvents Offsite POC: Implementation Plan

## Overview

This POC demonstrates an end-to-end flow: data ships in → features are extracted → sig events queries are generated → discoveries are produced → suggestions (ES|QL queries for alerts, dashboards, SLOs) are offered. The work builds on the existing Streams plugin, integrates with Agent Builder and the Security Entity Store, and adds semantic search, a three-stage discovery pipeline, and new UI pages.

Branch: `poc/sig-events-offsite` (rebased on `elastic/main`; structured as small, independent commits).

Reference: `poc/feature-skills` (single commit `2fed3b2e`) for patterns on Agent Builder tools/skills and the three-stage discovery pipeline.

---

## Architecture Decisions (Resolved)

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Entity store integration | Use Security Entity Store HTTP APIs (`PUT /api/entity_store/entities/{entityType}`). LLM decides entity type (host/user/service/generic). No direct plugin dependency. |
| 2 | Discoveries nesting depth | Max 3 levels (discovery → meta-discovery → meta²-discovery). |
| 3 | Cross-references | Bi-directional explicit ID references stored in each document. |
| 4 | Mermaid rendering | Render in Agent Builder chat UI conversation messages + standalone Topology tab in SigDiscovery page. |
| 5 | LLM model selection | SigDiscovery Settings page wins. Agent Builder does not override. Tools read from settings. |
| 6 | SigDiscovery Agent | Pre-built agent shipped by the Streams plugin via `agentBuilder.agents.register()`. |
| 7 | Logs tools | Reuse existing observability tools + new streams-specific tools (see Workstream 4). |
| 8 | Data persistence | Sig events query *results* → own data stream. Discoveries + suggestions → single managed index (`.kibana_streams_discoveries`). Features stay in `.kibana_streams_features`. |
| 9 | Semantic indexing | Assume model deployed. Use `semantic_text` field type with inference ID `.elser-2-elasticsearch`. `StorageIndexAdapter` has been extended to support `semantic_text` natively via `types.semantic_text({ inference_id })`. |
| 10 | ES\|QL STATS | Extend query schema with `queryType: 'row' \| 'stats'`, allow raw ES\|QL for stats queries, add separate execution/result handling path. |

---

## Workstreams

### Workstream 0: Insight → Discovery Migration

**Goal:** Rename the existing `Insight` type to `Discovery` and extend it with the new fields (relevance_score, cross-references, change point evidence, embedded recommendations). This is a breaking change — no backward compatibility needed.

The existing `Insight` type is a simpler predecessor of what we're calling `Discovery`. Rather than maintaining two parallel concepts, we replace `Insight` with `Discovery` throughout the codebase.

#### 0a. What Changes

**Schema (`@kbn/streams-schema/src/insights/index.ts` → rename file to `discovery.ts`):**

| Old | New | Notes |
|-----|-----|-------|
| `Insight` | `Discovery` | Extended with `uuid`, `relevance_score`, `level`, `feedback`, `tags`, cross-refs, change point evidence |
| `InsightEvidence` | `DiscoveryEvidence` | Extended with `change_point_type`, `change_point_p_value`. Renamed from camelCase to snake\_case fields. |
| `InsightImpactLevel` | `DiscoverySeverity` | Same values (`critical`/`high`/`medium`/`low`), renamed for consistency with the rest of the plan |
| `InsightsResult` | `DiscoveryPipelineResult` | Replaces `insights: Insight[]` with `discoveries: Discovery[]` + `suggestions: Suggestion[]` |
| *(new)* | `Recommendation` | Embedded in `Discovery.recommendations` |
| *(new)* | `Suggestion` | ES\|QL query suggestions |
| *(new)* | `ChangePointType` | Type for change point classification |

**Schema exports (`@kbn/streams-schema/index.ts`):**
- Remove: `export type { InsightsResult, Insight, InsightImpactLevel } from './src/insights'`
- Add: `export type { DiscoveryPipelineResult, Discovery, DiscoverySeverity, DiscoveryEvidence, Recommendation, Suggestion, ChangePointType } from './src/discovery'`

#### 0b. Server Pipeline Migration

| File | Change |
|------|--------|
| `insights/generate_insights.ts` → rename to `discovery/generate_discoveries.ts` | Replace `generateInsights` → `generateDiscoveries`. Return `DiscoveryPipelineResult` instead of `InsightsResult`. The two-stage process (per-stream → cross-stream) becomes the three-stage pipeline (Extract Discoveries → Enrich with Recommendations → Generate Suggestions). |
| `insights/utils.ts` → `discovery/utils.ts` | `extractInsightsFromResponse` → `extractDiscoveriesFromResponse`. Update to parse `Discovery` objects (with `uuid`, `relevance_score`, etc.). |
| `insights/schema.ts` → `discovery/schema.ts` | `SUBMIT_INSIGHTS_TOOL_NAME` → `SUBMIT_DISCOVERIES_TOOL_NAME` (`'submit_discoveries'`). Update Zod schema to match `Discovery` interface. |
| `insights/prompts/summarize_queries/` → `discovery/prompts/extract_discoveries/` | Rewrite system prompt: instead of "summarize queries into insights", instruct the LLM to "analyze data and extract discoveries with severity, relevance_score, evidence (including change point data), and sample events". |
| `insights/prompts/summarize_streams/` → `discovery/prompts/enrich_discoveries/` | Rewrite: instead of "summarize stream insights", instruct the LLM to "synthesize discoveries across streams, add recommendations, identify meta-discoveries". |

#### 0c. Server Routes Migration

| Old Route | New Route | Notes |
|-----------|-----------|-------|
| `POST /internal/streams/_insights/_task` | `POST /internal/streams/_discovery/_task` | Triggers discovery pipeline (replaces insights generation) |
| `POST /internal/streams/_insights/_status` | `POST /internal/streams/_discovery/_status` | Returns pipeline status |

The task definition in `tasks/task_definitions/insights_discovery.ts` is renamed and updated to use `DiscoveryPipelineResult`.

#### 0d. UI Migration

| Old Component | New Component | Notes |
|---------------|---------------|-------|
| `significant_events_discovery/components/insights/summary.tsx` | `significant_events_discovery/components/discoveries/summary.tsx` | Renders discovery list with relevance scores, severity badges, change point indicators |
| `significant_events_discovery/components/insights/insight_card.tsx` | `significant_events_discovery/components/discoveries/discovery_card.tsx` | `InsightCard` → `DiscoveryCard`. Extended to show: relevance score bar, change point type badge, cross-reference links, feedback buttons |
| `significant_events_discovery/components/insights/tab.tsx` | `significant_events_discovery/components/discoveries/tab.tsx` | `InsightsTab` → `DiscoveriesTab` |
| `significant_events_discovery/components/insights/feedback_buttons.tsx` | `significant_events_discovery/components/discoveries/feedback_buttons.tsx` | Feedback buttons component (already exists) |
| Tab label: "Insights" | Tab label: "Discoveries" | |

#### 0e. Tool and Prompt Migration

| Old | New |
|-----|-----|
| `SUBMIT_INSIGHTS_TOOL_NAME = 'submit_insights'` | `SUBMIT_DISCOVERIES_TOOL_NAME = 'submit_discoveries'` |
| `insightsSchema` (Zod) | `discoverySchema` (Zod) — extended with all Discovery fields |
| System prompt: "submit your findings using the submit_insights tool" | "submit your findings using the submit_discoveries tool" |

#### 0f. Telemetry Migration

| Old | New |
|-----|-----|
| `STREAMS_INSIGHTS_GENERATED_EVENT_TYPE = 'streams-insights-generated'` | `STREAMS_DISCOVERIES_GENERATED_EVENT_TYPE = 'streams-discoveries-generated'` |
| `StreamsInsightsGeneratedProps` | `StreamsDiscoveriesGeneratedProps` — add `discovery_count`, `suggestion_count` |
| `trackInsightsGenerated()` | `trackDiscoveriesGenerated()` |

#### 0g. i18n Key Migration

All `xpack.streams.insights.*` keys are renamed to `xpack.streams.discoveries.*`. Since this is a POC branch with no translation concerns, this is a straightforward find-and-replace.

#### 0h. What Stays the Same

- The overall pipeline architecture (per-stream analysis → cross-stream synthesis) is preserved, just extended with more stages.
- The task-based execution model (background task with status polling) is preserved.
- The UI layout (tab in SigDiscovery page with cards) is preserved, just enhanced.

**Commit plan:**
- Commit 0a: Schema rename (`Insight` → `Discovery`) + new fields in `@kbn/streams-schema`
- Commit 0b: Server pipeline rename + route migration
- Commit 0c: UI component rename + `DiscoveryCard` with new fields
- Commit 0d: Telemetry + i18n key migration

---

### Workstream 1: Data Persistence & Schema Types

**Goal:** Establish the data layer for discoveries, suggestions, and sig events query results.

#### 1a. Discovery & Suggestion Schema (`@kbn/streams-schema`)

New types to add:

```typescript
// --- Discovery ---

type DiscoverySeverity = 'critical' | 'high' | 'medium' | 'low';

type ChangePointType = 'spike' | 'dip' | 'step_change' | 'trend_change' | 'distribution_change' | 'stationary' | 'non_stationary' | 'indeterminable';

// Note: uses snake_case to match Elasticsearch mapping convention.
// The old InsightEvidence used camelCase (streamName, queryTitle) — DiscoveryEvidence
// replaces it with snake_case since these fields are stored in Elasticsearch.
interface DiscoveryEvidence {
  stream_name: string;
  query_title: string;
  feature_name?: string;
  event_count: number;
  change_point_type?: ChangePointType;  // from sig events change point analysis
  change_point_p_value?: number;        // statistical significance (lower = more significant)
}

interface Discovery {
  uuid: string;
  title: string;
  description: string;
  severity: DiscoverySeverity;
  // LLM-assigned relevance score (0–100). Measures how actionable / important
  // this discovery is for the user. The pipeline prompt instructs the LLM to
  // assign this score based on: impact breadth, confidence of evidence,
  // novelty (not a known/expected pattern), and actionability.
  relevance_score: number;       // 0-100, LLM-assigned
  evidence: DiscoveryEvidence[];
  sample_events?: Record<string, unknown>[];  // optional: raw event payloads
  recommendations?: Recommendation[];         // optional: embedded recommendations from Stage 2
  // Cross-references (bi-directional IDs)
  feature_refs?: string[];       // feature UUIDs (optional — not every discovery has feature refs)
  query_refs?: string[];         // query asset UUIDs (optional)
  stream_refs: string[];         // stream names (required — every discovery comes from at least one stream)
  discovery_refs?: string[];     // parent discovery UUIDs (optional — only for meta-discoveries)
  // Meta
  level: number;                 // 0 = base, 1 = meta, 2 = meta² (max 2)
  created_at: string;
  updated_at: string;
  connector_id: string;
  tags?: string[];
  feedback?: 'useful' | 'not_useful' | null;  // user feedback, stored on the document
}

// --- Suggestion (ES|QL query suggestions) ---

type SuggestionType = 'alert' | 'dashboard' | 'slo' | 'viz' | 'investigation';
type SuggestionStatus = 'pending' | 'accepted' | 'dismissed';

interface Suggestion {
  uuid: string;
  title: string;                 // human-readable title for the suggestion
  description: string;           // what this query does and why it matters
  reason: string;                // why this query was selected (ties back to discoveries)
  type: SuggestionType;          // what Kibana object you would create from this query
  esql_query: string;            // the actual ES|QL query
  priority: 'critical' | 'high' | 'medium' | 'low';
  discovery_refs: string[];      // discovery UUIDs this came from (required, at least one)
  stream_refs: string[];         // stream names the query targets (derived from discoveries)
  status: SuggestionStatus;
  created_at: string;
}

// --- Recommendation (new type, output of Stage 2: Enrich Discoveries) ---

interface Recommendation {
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  steps: string[];               // ordered action steps
}

// --- Pipeline result ---

interface DiscoveryPipelineResult {
  discoveries: Discovery[];      // from Stages 1-2 (discoveries include embedded recommendations)
  suggestions: Suggestion[];     // from Stage 3
  tokensUsed: ChatCompletionTokenCount;
}
```

**Relevance score design:**

The `relevance_score` (0–100) is assigned by the LLM during Stage 1 (Extract Discoveries). The prompt instructs the LLM to score each discovery on four axes:

| Axis | Weight | Description |
|------|--------|-------------|
| Impact breadth | 30% | How many streams/services/users are affected |
| Evidence confidence | 25% | Strength and quantity of supporting evidence |
| Novelty | 25% | Is this a new/unexpected pattern vs. known/expected behavior |
| Actionability | 20% | Can the user take concrete action based on this |

The score is used for:
- Default sort order in the Discoveries table (highest relevance first)
- Filtering (e.g., "show only discoveries with relevance > 70")
- Meta-discovery input selection (prefer high-relevance base discoveries)
- Suggestion prioritization (discoveries with higher relevance produce higher-priority suggestions)

Extend existing types:
- `Feature`: add `discovery_refs: string[]` and `query_refs: string[]` for bi-directional refs.
- `StreamQuery`: add `queryType: 'row' | 'stats'`, make `kql` optional when `queryType === 'stats'`, add `feature_refs: string[]` and `discovery_refs: string[]`.

#### 1b. Discoveries Index

**Index:** `.kibana_streams_discoveries` (managed index, created directly via `esClient.indices.create` to support `semantic_text`).

Mapping (discovery documents, `doc_type: 'discovery'`):

| Field | Type | Notes |
|-------|------|-------|
| `uuid` | keyword | Document ID |
| `doc_type` | keyword | `'discovery'` or `'suggestion'` — discriminator |
| `title` | keyword | Exact match |
| `title_semantic` | semantic_text | Semantic search (copy of title) |
| `description` | text | Full-text search |
| `description_semantic` | semantic_text | Semantic search (copy of description) |
| `severity` | keyword | `critical` / `high` / `medium` / `low` |
| `relevance_score` | integer | 0–100, LLM-assigned |
| `evidence` | nested | Array of `{ stream_name, query_title, feature_name?, event_count, change_point_type?, change_point_p_value? }` |
| `sample_events` | object (enabled: false) | Raw event payloads, not indexed |
| `recommendations` | nested | Array of `{ title, description, priority, steps[] }` |
| `feature_refs` | keyword | Array of feature UUIDs |
| `query_refs` | keyword | Array of query UUIDs |
| `stream_refs` | keyword | Array of stream names |
| `discovery_refs` | keyword | Parent discovery UUIDs |
| `level` | integer | 0, 1, or 2 |
| `created_at` | date | |
| `updated_at` | date | |
| `connector_id` | keyword | |
| `tags` | keyword | |
| `feedback` | keyword | `'useful'` / `'not_useful'` / null |

Suggestion documents (`doc_type: 'suggestion'`) share the same index. They reuse the shared fields from the discovery mapping above (`uuid`, `doc_type`, `title`, `title_semantic`, `description`, `description_semantic`, `created_at`, `stream_refs`) and add these suggestion-specific fields:

| Field | Type | Notes |
|-------|------|-------|
| `suggestion_type` | keyword | `'alert'` / `'dashboard'` / `'slo'` / `'viz'` / `'investigation'` (maps from `Suggestion.type` — renamed to avoid collision with `doc_type`) |
| `esql_query` | text | The ES\|QL query being suggested |
| `esql_query_semantic` | semantic_text | Semantic search over the query |
| `reason` | text | Why this query was selected |
| `priority` | keyword | `critical` / `high` / `medium` / `low` |
| `status` | keyword | `'pending'` / `'accepted'` / `'dismissed'` |
| `discovery_refs` | keyword | Source discovery UUIDs |
| `stream_refs` | keyword | Stream names the query targets |

#### 1c. Sig Events Query Results Data Stream

**Data stream:** `.streams.sig_events_results-default`

This stores the *results* of sig events query executions (the matched documents/aggregations). Separate from the query definitions (which stay in `.kibana_streams_assets`).

Mapping follows the existing alerts pattern but includes aggregation result support:

| Field | Type | Notes |
|-------|------|-------|
| `@timestamp` | date | |
| `query_id` | keyword | Reference to query asset UUID |
| `stream_name` | keyword | |
| `query_type` | keyword | `'row'` or `'stats'` |
| `result` | object (enabled: false) | Raw result payload |
| `event_count` | long | |

#### 1d. Semantic Indexing for Features and Queries

Extend `.kibana_streams_features` mapping:
- Add `feature.description_semantic` as `semantic_text` (copy of `feature.description`).
- Add `feature.title_semantic` as `semantic_text`.

Extend `.kibana_streams_assets` mapping:
- Add `query.title_semantic` as `semantic_text`.
- Add `query.kql.query_semantic` as `semantic_text`.

**Note:** Since `StorageIndexAdapter` doesn't support `semantic_text`, we need to either:
1. Extend `StorageIndexAdapter` to support `semantic_text` (preferred — benefits the whole platform), or
2. Apply a mapping update after index creation via `esClient.indices.putMapping`.

Option 2 is simpler for a POC. The semantic fields are additive and don't conflict with existing mappings.

#### 1e. Semantic Text Population During Indexing

`semantic_text` fields are populated automatically by Elasticsearch when the field is mapped — the value written to the source field is processed by the configured inference model at index time. However, the semantic fields in this plan use separate field names (`title_semantic`, `description_semantic`, etc.), so the write path must explicitly copy values:

**Discoveries index (`.kibana_streams_discoveries`):**
- On write, the `DiscoveryClient` sets `title_semantic = title` and `description_semantic = description` in the document body. Elasticsearch's `semantic_text` mapping handles embedding generation.
- For suggestions: `esql_query_semantic = esql_query`.

**Features index (`.kibana_streams_features`):**
- The `FeatureClient.bulk()` method is extended: when writing a feature, also set `feature.title_semantic = feature.title` and `feature.description_semantic = feature.description`.
- The `putMapping` call (Option 2 above) adds the semantic fields; the write path populates them.

**Queries index (`.kibana_streams_assets`):**
- The `QueryClient` write methods are extended: set `query.title_semantic = query.title` and `query.kql.query_semantic = query.kql.query`.

**Search usage:**
- `streams.search_discoveries` tool uses `semantic_text` query on `title_semantic` and `description_semantic` fields.
- Feature search (when semantic search is requested) queries `feature.title_semantic` and `feature.description_semantic`.
- Query search queries `query.title_semantic`.
- All semantic searches use `semantic` query type (not `match`), which routes through the inference model.

**Commit plan:**
- Commit 1: Schema types in `@kbn/streams-schema` (Discovery with relevance_score, Suggestion with esql_query, DiscoveryPipelineResult) + unit tests for schema validation
- Commit 2: Discoveries index creation + client (DiscoveryClient) + unit tests for CRUD
- Commit 3: Sig events results data stream
- Commit 4: Semantic field mapping updates for features and queries

---

### Workstream 2: Three-Stage Discovery Pipeline

**Goal:** Extend the renamed discovery pipeline into a three-stage process: Extract Discoveries → Enrich with Recommendations → Generate Suggestions.

This follows the pattern from `poc/feature-skills` but adds:
- Support for ES|QL STATS queries in the tools
- Bi-directional cross-reference writing
- Persistence of discoveries to the new index

#### 2a. Pipeline Stages

**Stage 1 — Extract Discoveries (reasoning agent, max 8 steps)**

Tools available (internal pipeline tools, not the same as Agent Builder tools — these are callback functions passed to the LLM reasoning agent within the pipeline):
- `get_stream_features` — read features for a stream (calls FeatureClient)
- `search_events` — execute ES|QL (row or STATS) against a stream (calls esClient)
- `get_query_definitions` — read existing sig events query definitions (calls QueryClient)
- `get_query_results` — execute a specific query and return results (calls esClient)
- `get_sig_events_with_change_points` — read sig events occurrences + change point data from the alerts index (wraps `readSignificantEventsFromAlertsIndices`). Returns per-query: occurrence time series, change point type (spike/dip/step_change/trend_change/distribution_change/stationary), p-value, and change point timestamp. This is the **primary analysis tool** — it tells the LLM which queries are showing statistically significant changes.
- `get_log_patterns` — categorize log messages and return top patterns with counts (uses `categorize_text` aggregation directly against the stream index). Helps the LLM identify dominant error patterns and exceptions.
- `run_log_rate_analysis` — compare a baseline time window against a deviation window to identify which field/value combinations correlate with throughput changes (wraps the same analysis logic as `observability.run_log_rate_analysis`). Returns significant items with p-values, field names, and field values. Helps the LLM identify root causes of spikes/dips.
- `search_discoveries` — search existing discoveries via semantic search (calls DiscoveryClient)
- `submit_discoveries` — persist discoveries to the index (calls DiscoveryClient, writes bi-directional refs)

**Key analysis flow:** The pipeline first calls `get_sig_events_with_change_points` to identify which queries have statistically significant changes (spike, dip, step_change, trend_change). The LLM then focuses its analysis on queries with non-stationary change points (low p-value), using `search_events` and `get_query_results` to investigate the underlying data. This avoids wasting LLM steps on queries with no interesting changes.

Prompt: Analyze stream data, features, and query results to identify significant patterns, anomalies, and operational insights. Start by reviewing the change point data to identify which queries show statistically significant changes. Focus investigation on non-stationary queries. For each discovery, provide:
- Evidence (streams, queries, features, event counts, change point type and p-value)
- Severity (critical/high/medium/low)
- Relevance score (0–100) based on: impact breadth (30%), evidence confidence (25%), novelty (25%), actionability (20%)
- Sample events demonstrating the pattern

**Stage 2 — Enrich Discoveries with Recommendations (reasoning agent, max 6 steps)**

Tools: same as Stage 1 + `update_discovery` (adds recommendations to existing discoveries).
Input: discoveries from Stage 1.
Output: discoveries enriched with embedded `Recommendation[]` objects (title, description, priority, steps). The LLM also synthesizes cross-stream patterns and may create meta-discoveries at this stage.

**Stage 3 — Generate Suggestions (reasoning agent, max 6 steps)**

Tools: `search_discoveries`, `get_stream_features`, `get_query_definitions`, `submit_suggestions`.
Input: enriched discoveries from Stage 2.
Output: ES|QL query suggestions (see Workstream 3 for details).

**Note:** The old three-stage model (Extract Discoveries → Generate Insights → Generate Recommendations) is simplified. "Insights" no longer exist as a separate concept — they are discoveries. "Recommendations" are embedded in discoveries rather than being a separate output. The suggestion stage (previously described as Stage 4) is now Stage 3.

#### 2b. ES|QL STATS Support in Tools

The `search_events` tool needs two execution paths:

**Row queries (existing):**
```
FROM stream | WHERE KQL("...") | METADATA _id, _source
```
Returns `{ _id, _source }[]`.

**Stats queries (new):**
```
FROM stream | WHERE KQL("...") | STATS count = COUNT(*) BY host.name
```
Returns `{ columns: Column[], values: unknown[][] }` — the raw ES|QL tabular result.

The tool detects query type from the query schema (`queryType` field) or by parsing the ES|QL AST for STATS commands.

`get_query_results` similarly branches:
- Row queries → return documents
- Stats queries → return tabular results with column metadata

#### 2c. Cross-Reference Writing

When `submit_discoveries` persists a discovery:
1. Write the discovery document with `feature_refs`, `query_refs`, `stream_refs`.
2. Update referenced features: add `discovery.uuid` to their `discovery_refs`.
3. Update referenced queries: add `discovery.uuid` to their `discovery_refs`.

This ensures bi-directional references. Use bulk operations for efficiency.

**Stale reference handling:** Lazy on read. When a discovery is fetched and its `feature_refs` or `query_refs` point to deleted documents, the stale refs are silently removed from the response (and optionally cleaned up in the background). No eager cleanup on delete.

#### 2d. Meta-Discoveries (Discoveries of Discoveries)

Meta-discoveries emerge organically through the `streams.search_discoveries` tool. During Stage 1, the LLM can call this tool to fetch existing discoveries and incorporate them as context. When it produces a discovery that synthesizes existing ones:
- It sets `level = max(referenced_discovery.level) + 1` (capped at 2).
- It populates `discovery_refs` with the UUIDs of the source discoveries.
- The pipeline validates that `level` does not exceed 2; if it does, the discovery is stored at level 2 with a warning.

This means meta-discoveries don't need a separate pipeline entry point — they happen naturally when the LLM decides existing discoveries are relevant to a new finding.

**Commit plan:**
- Commit 5: Pipeline stages (prompts, schemas, tool callbacks)
- Commit 6: ES|QL STATS execution path
- Commit 7: Cross-reference writing logic
- Commit 8: Meta-discovery support (level validation, discovery_refs population in submit_discoveries)

---

### Workstream 3: Suggestions (from Discoveries)

**Goal:** Generate ES|QL query suggestions from discoveries, categorized by the Kibana object you would create from them.

#### 3a. Suggestion Types

Each suggestion is an ES|QL query with a `type` field indicating what Kibana object it targets:

| Type | What the ES|QL query does | Example |
|------|--------------------------|---------|
| `alert` | Detects a condition that should trigger an alert rule | `FROM logs-nginx.* \| WHERE status >= 500 \| STATS error_count = COUNT(*) BY host.name \| WHERE error_count > 100` |
| `dashboard` | Powers a full dashboard (multiple panels, overview) | `FROM logs-nginx.* \| STATS req_count = COUNT(*), p99 = PERCENTILE(duration, 99) BY service.name, @timestamp = BUCKET(@timestamp, 5m)` |
| `slo` | Measures a service level indicator for an SLO definition | `FROM logs-nginx.* \| STATS total = COUNT(*), good = COUNT_IF(status < 500) BY service.name \| EVAL sli = good / total` |
| `viz` | Powers a single visualization (chart, table, metric, heatmap) | `FROM logs-nginx.* \| STATS error_rate = COUNT_IF(status >= 500) / COUNT(*) BY @timestamp = BUCKET(@timestamp, 1h)` |
| `investigation` | Identifies a finding that requires human follow-up (case/investigation) | N/A — no ES\|QL query; the suggestion describes what to investigate and why |

#### 3b. Suggestion Generation

This is Stage 3 of the pipeline (see Workstream 2):

**Stage 3 — Generate Suggestions (reasoning agent)**

Input: enriched discoveries (with embedded recommendations) + stream features.
Output: ES|QL queries with metadata.

The LLM prompt instructs the agent to:
1. For each high-relevance discovery, generate 1–3 ES|QL queries.
2. Classify each query by type (`alert`, `dashboard`, `slo`, `viz`, `investigation`).
3. Provide a `title` (what the query monitors), `description` (what it does technically), and `reason` (why this query was selected, referencing the discovery).
4. Use STATS for stats queries (dashboards, SLOs, threshold alerts).
5. Use row-based queries for event-level alerts.
6. Reference the correct stream indices from the discovery's `stream_refs`.

Each suggestion includes:
- `esql_query` — the actual ES|QL query string
- `title` — human-readable name (e.g., "Error rate by service")
- `description` — what the query does (e.g., "Counts 5xx errors per service per 5-minute bucket")
- `reason` — why it was suggested (e.g., "Discovery found elevated error rates in nginx; this query enables continuous monitoring")
- `type` — what Kibana object to create (`alert` / `dashboard` / `slo` / `viz` / `investigation`)
- `priority` — derived from the source discovery's severity and relevance_score
- `discovery_refs` — which discoveries it came from
- `status: 'pending'` — user must accept/dismiss

#### 3c. Suggestion Acceptance

For the POC, "Accept" marks the suggestion as accepted and copies the ES|QL query to clipboard or opens it in Discover. The `type` field tells the user what they would create from this query:
- `alert` → create an ES|QL alerting rule with this query
- `dashboard` → create a dashboard with panels powered by this query
- `slo` → create an SLO with this query as the SLI definition
- `viz` → create a single Lens visualization from this query
- `investigation` → open a case/investigation for human follow-up (no ES|QL query)

Actual Kibana object creation is a stretch goal. The `type` field is informational for the POC — it guides the user on what to do with the query.

"Dismiss" marks the suggestion as dismissed and hides it from the default view.

#### 3d. Suggestion Validation

Before persisting, each suggested ES|QL query is validated:
1. Parse the ES|QL AST to check syntax (using `@kbn/esql-language`).
2. Optionally dry-run against Elasticsearch with `size: 0` to verify the query executes.
3. **Invalid queries are rejected** — only syntactically valid ES|QL is persisted. Invalid queries are logged with the validation error for debugging but not stored.

#### 3e. Suggestion Deduplication

Before persisting, check if an identical ES|QL query already exists (normalized string comparison):
- If a duplicate exists, update the existing suggestion's `discovery_refs` to include the new source discoveries (merge refs).
- Do not create a new suggestion document.
- This prevents the suggestions list from growing with duplicates across pipeline runs.

**Commit plan:**
- Commit 9: Suggestion generation stage (prompt + schema + tool)
- Commit 10: Suggestion CRUD (create, list, accept/dismiss) + validation

---

### Workstream 4: Agent Builder Integration

**Goal:** Ship a pre-built SigDiscovery Agent with tools and skills.

#### 4a. Namespace and Allow Lists

Add to `@kbn/agent-builder-common/base/namespaces.ts`:
```typescript
// In internalNamespaces:
streams: 'streams',

// In protectedNamespaces array:
internalNamespaces.streams,
```

Add to `AGENT_BUILDER_BUILTIN_AGENTS` in `@kbn/agent-builder-server/allow_lists.ts`:
```typescript
`${internalNamespaces.streams}.sig_discovery_agent`,
```

Add to `@kbn/agent-builder-server/allow_lists.ts`:
```typescript
// Streams tools — features
`streams.get_stream_features`,
`streams.upsert_features`,
// Streams tools — sig events queries
`streams.get_sig_events_queries`,
`streams.upsert_sig_events_queries`,
// Streams tools — analysis
`streams.get_sig_events_with_change_points`,
// Streams tools — discoveries
`streams.search_discoveries`,
`streams.get_discovery`,
`streams.create_discovery`,
`streams.run_discovery_pipeline`,
// Streams tools — query promotion
`streams.promote_queries`,
// Streams tools — entity store
`streams.push_entity_definition`,
`streams.list_entities`,
```

#### 4b. Tools (registered in Streams plugin setup)

| Tool ID | Description | Parameters |
|---------|-------------|------------|
| `streams.get_stream_features` | Read features for a stream | `streamName`, optional `from`/`to` |
| `streams.upsert_features` | Write features to the feature store | `streamName`, `features[]` |
| `streams.get_sig_events_queries` | Read sig events query definitions | `streamName`, optional filters |
| `streams.upsert_sig_events_queries` | Write sig events queries | `streamName`, `queries[]` |
| `streams.get_sig_events_with_change_points` | Read sig events occurrences + change point analysis from alerts index | `streamNames[]`, `from`, `to`, optional `bucketSize` |
| `streams.search_discoveries` | Semantic search over discoveries | `query` (natural language), optional `streamName`, `severity`, `level`, `min_relevance_score` |
| `streams.get_discovery` | Fetch a single discovery by UUID (includes evidence, refs, feedback) | `uuid` |
| `streams.create_discovery` | Persist a new discovery directly (without running the full pipeline) | `discovery` object (title, description, severity, relevance_score, evidence, refs, etc.) |
| `streams.run_discovery_pipeline` | Trigger the three-stage discovery pipeline | `streamNames[]`, optional `connectorId` |
| `streams.push_entity_definition` | Push entity features to the Security Entity Store | `entities[]` (LLM decides type: host/user/service/generic) |
| `streams.list_entities` | Search/list entities from the Security Entity Store | `entity_types[]` (required), optional `filterQuery`, `page`, `per_page`, `sort_field`, `sort_order` |
| `streams.promote_queries` | Promote stored sig events queries to active Kibana alerting rules | `streamName`, optional `queryIds[]` (if omitted, promotes all unbacked queries) |

#### 4c. Skills

**Skill: `extract-stream-features`** (from `poc/feature-skills`)
- Content: instructions on when/how to use `get_stream_features` and `upsert_features`
- Registry tools: `streams.get_stream_features`, `streams.upsert_features`

**Skill: `generate-sig-events-queries`**
- Content: instructions on analyzing features and generating KQL/ES|QL queries. Covers: how to use existing change point data to inform query design, when to generate row vs stats queries.
- Registry tools: `streams.get_stream_features`, `streams.get_sig_events_queries`, `streams.upsert_sig_events_queries`, `streams.get_sig_events_with_change_points`

**Skill: `generate-discoveries`**
- Content: instructions on how to analyze stream data, features, and existing discoveries to produce new discoveries. Covers: start by reviewing change point data to identify queries with significant changes, then investigate underlying data, how to search existing discoveries (to build meta-discoveries), how to assign severity and relevance_score, how to provide evidence (including change point type and p-value), and when to use `create_discovery` vs `run_discovery_pipeline`.
- Registry tools: `streams.get_stream_features`, `streams.get_sig_events_queries`, `streams.get_sig_events_with_change_points`, `streams.search_discoveries`, `streams.get_discovery`, `streams.create_discovery`, `streams.run_discovery_pipeline`

**Skill: `generate-suggestions`**
- Content: instructions on generating ES|QL query suggestions from discoveries. Covers: when to use STATS vs row queries, how to classify by type (alert/dashboard/slo/viz/investigation), how to write the reason field referencing the source discovery, how to derive priority from relevance_score, and how to use change point data to inform alert threshold suggestions.
- Registry tools: `streams.search_discoveries`, `streams.get_discovery`, `streams.get_stream_features`, `streams.get_sig_events_queries`, `streams.get_sig_events_with_change_points`

**Skill: `push-entity-definition`**
- Content: instructions on mapping discovered features to entity definitions and pushing to the entity store. Includes: how to check for existing entities first (via `list_entities`), how to classify entity types, and how to handle duplicates.
- Registry tools: `streams.get_stream_features`, `streams.search_discoveries`, `streams.push_entity_definition`, `streams.list_entities`

#### 4d. Pre-Built SigDiscovery Agent

Registered via `agentBuilder.agents.register()` in the Streams plugin `setup()`. This makes the agent always available when the Streams plugin is enabled — no user action required.

```typescript
agentBuilder.agents.register({
  id: 'streams.sig_discovery_agent',
  name: 'SigDiscovery Agent',
  description: 'Agent specialized in discovering significant events, extracting features, and generating discoveries from log streams',
  avatar_icon: 'crosshairs',
  availability: {
    cacheMode: 'space',
    handler: async ({ request }) => {
      // Available when streams significant events discovery is enabled
      return { available: isSignificantEventsDiscoveryEnabled() };
    },
  },
  configuration: ({ request }) => ({
    instructions: getSigDiscoveryAgentInstructions(),
    tools: [{
      tool_ids: [
        // Streams tools — all 12
        'streams.get_stream_features',
        'streams.upsert_features',
        'streams.get_sig_events_queries',
        'streams.upsert_sig_events_queries',
        'streams.get_sig_events_with_change_points',
        'streams.search_discoveries',
        'streams.get_discovery',
        'streams.create_discovery',
        'streams.run_discovery_pipeline',
        'streams.promote_queries',
        'streams.push_entity_definition',
        'streams.list_entities',
        // Observability tools (globally available from observability_agent_builder)
        'observability.get_log_groups',
        'observability.run_log_rate_analysis',
        'observability.get_log_change_points',
        'observability.get_alerts',
        'observability.get_services',
        'observability.get_index_info',
        'observability.get_traces',
        'observability.get_service_topology',
        // Platform tools
        'platform.core.list_indices',
        'platform.core.get_index_mapping',
        'platform.core.execute_esql',
        'platform.core.product_documentation',
      ],
    }],
  }),
});
```

**Registration location:** `x-pack/platform/plugins/shared/streams/server/plugin.ts` in `setup()`, guarded by `if (plugins.agentBuilder)`.

**Availability:** The agent is visible in Agent Builder only when the `significantEventsDiscovery` feature flag is enabled. This mirrors the observability agent pattern which uses an availability handler.

#### 4e. Mermaid Diagram Support

The Agent Builder chat UI needs to detect Mermaid code blocks in agent responses and render them.

In `chat_message_text.tsx` (or the markdown renderer):
- Detect ` ```mermaid ` code blocks
- Lazy-load the `mermaid` npm package only when a Mermaid block is detected (avoids ~3MB in the initial bundle)
- Render the diagram into an SVG element within the chat message
- Fallback: show raw Mermaid source if rendering fails

The SigDiscovery Agent's system prompt should include instructions on when to generate Mermaid diagrams (topology maps, data flows, dependency graphs).

#### 4f. Pipeline Tools vs Agent Builder Tools

The pipeline (Workstream 2) uses internal tool callbacks that are not registered with Agent Builder. The Agent Builder tools (Workstream 4) are separate registrations that wrap the same underlying services. This table maps them:

| Pipeline tool (internal) | Agent Builder tool (registered) | Notes |
|--------------------------|--------------------------------|-------|
| `get_stream_features` | `streams.get_stream_features` | Same FeatureClient, different entry point |
| `search_events` | `platform.core.execute_esql` | Agent uses the platform ES\|QL tool directly |
| `get_query_definitions` | `streams.get_sig_events_queries` | Same QueryClient |
| `get_query_results` | `platform.core.execute_esql` | Agent composes the query and executes via platform tool |
| `get_sig_events_with_change_points` | `streams.get_sig_events_with_change_points` | Same underlying `readSignificantEventsFromAlertsIndices` |
| `get_log_patterns` | `observability.get_log_groups` | Pipeline uses `categorize_text` directly; agent uses observability tool |
| `run_log_rate_analysis` | `observability.run_log_rate_analysis` | Same analysis logic, different entry point |
| `search_discoveries` | `streams.search_discoveries` | Same DiscoveryClient |
| `submit_discoveries` | `streams.create_discovery` | Agent Builder version creates one discovery at a time |
| `submit_suggestions` | *(no equivalent)* | Pipeline-internal; suggestions are created by the pipeline, not via Agent Builder |
| *(no equivalent)* | `streams.list_entities` | Agent Builder only — queries the Entity Store |

#### 4g. LLM Model Selection

Tools that invoke LLM operations (`run_discovery_pipeline`, `get_stream_features` with AI extraction) read the connector ID from the SigDiscovery Settings (saved object), not from Agent Builder's connector selection.

**Commit plan:**
- Commit 11: Namespace + allow list additions
- Commit 12: Tool definitions and registration
- Commit 13: Skill definitions
- Commit 14: Pre-built SigDiscovery Agent
- Commit 15: Mermaid rendering in chat UI

---

### Workstream 5: Entity Store Integration

**Goal:** Push discovered entity features to the Security Entity Store and allow the LLM to query existing entities.

#### 5a. Entity Store Enablement on Startup

The Streams plugin ensures the Entity Store is enabled during `start()`:

```typescript
// In streams plugin start()
if (plugins.securitySolution) {
  try {
    // Enable the entity store so push/list tools always work
    await fetch('POST /api/entity_store/enable', {
      body: { entityTypes: ['host', 'user', 'service', 'generic'] },
    });
  } catch (e) {
    // Already enabled, or Security Solution not available — log and continue
    logger.debug(`Entity Store enable: ${e.message}`);
  }
}
```

This is idempotent — calling enable when already enabled is a no-op. If the Security Solution plugin is not installed, the Streams plugin skips entity store integration entirely (optional dependency).

**Config requirement:** Ensure `xpack.securitySolution.experimentalFeatures.entityStoreDisabled` is NOT set to `true` (it defaults to `false`).

#### 5b. Entity Mapping

The LLM decides the entity type mapping. The `push_entity_definition` tool prompt instructs the LLM to classify each discovered entity into one of the four supported types:

| Entity Store Type | When to use | Example features |
|-------------------|-------------|------------------|
| `host` | Entity represents a machine, server, VM, container, or node | `host.name`, `host.ip`, `container.id` |
| `user` | Entity represents a person or service account | `user.name`, `user.email`, `user.id` |
| `service` | Entity represents an application, microservice, or daemon | `service.name`, `service.version` |
| `generic` | Everything else (databases, network devices, clusters, etc.) | Any entity that doesn't fit the above three |

The tool validates the LLM's choice: if the entity has fields that clearly match `host`/`user`/`service` ECS patterns, it uses that type. Otherwise it falls back to `generic`.

#### 5c. Push Mechanism

The `streams.push_entity_definition` tool:
1. Takes discovered entity features from the feature store.
2. Maps them to the Entity Store schema (`EntityField` with `id`, `name`, `type`, `attributes`).
3. Calls `PUT /api/entity_store/entities/bulk` for bulk upsert (or `PUT /api/entity_store/entities/{entityType}` for single).
4. Stores the entity store reference back in the feature's `meta` field.

#### 5d. List Entities Tool

A new `streams.list_entities` tool lets the LLM query entities from the Entity Store:

| Tool ID | Description | Parameters |
|---------|-------------|------------|
| `streams.list_entities` | Search/list entities from the Security Entity Store | `entity_types` (required, array of `host`/`user`/`service`/`generic`), optional `filterQuery` (ES query JSON), `page`, `per_page`, `sort_field`, `sort_order` |

The tool wraps `GET /api/entity_store/entities/list` and returns:
```typescript
{
  records: Entity[];   // array of entity objects
  total: number;       // total matching entities
  page: number;
  per_page: number;
}
```

This enables the LLM to:
- Check if an entity already exists before pushing a duplicate
- Enrich discoveries with entity context (e.g., "this host has been involved in 3 other incidents")
- Cross-reference discovered features with known entities

#### 5e. Entity Maintainer (Periodic Sync)

Register an entity maintainer via `entityStore.registerEntityMaintainer()`:
- Runs periodically (e.g., every 15 minutes).
- Reads new/updated entity features from `.kibana_streams_features`.
- Pushes to the entity store.
- Handles deduplication via `entity.hashedId`.

**Dependency:** The Streams plugin needs an optional dependency on the Security Solution plugin. If the Security Solution is not available, the entity tools and maintainer are not registered.

**Commit plan:**
- Commit 16: Entity Store enablement on startup + entity mapping logic
- Commit 17: `push_entity_definition` tool implementation
- Commit 18: `list_entities` tool implementation
- Commit 19: Entity maintainer registration

---

### Workstream 6: SigDiscovery Settings Page

**Goal:** Allow configuring which LLM model is used for each pipeline stage.

#### 6a. Settings Saved Object

Extend the existing `significantEventsPromptsConfig` saved object (or create a new one):

```typescript
interface SigDiscoverySettings {
  feature_extraction_connector_id?: string;
  query_generation_connector_id?: string;
  discovery_connector_id?: string;
  suggestion_connector_id?: string;
}
```

**Default behavior:** When a connector ID is not set for a stage, the system falls back to the global default AI connector (from `GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR` in uiSettings, resolved via the existing `resolveConnectorId()` utility). This means the settings page works out of the box — users only need to configure per-stage connectors if they want different models for different stages.

**Fallback chain:** Stage-specific setting → Global default AI connector → Error ("no connector configured").

#### 6b. Settings API

- `GET /internal/streams/_discovery/_settings` — read current settings (returns saved values + resolved defaults)
- `PUT /internal/streams/_discovery/_settings` — update settings (partial update, only provided fields are changed)

#### 6c. Settings UI

A "Settings" section within the SigDiscovery page (accessible via a tab or gear icon):
- Four connector selectors (one per pipeline stage: feature extraction, query generation, discovery, suggestions)
- Each shows available AI connectors with a "(default)" label on the global default
- Empty selection means "use global default"
- Save button persists to the saved object

**Commit plan:**
- Commit 20: Settings saved object + API
- Commit 21: Settings UI component

---

### Workstream 7: UI Pages

**Goal:** Add Discoveries page, Suggestions page (inside SigDiscovery), and update existing pages.

#### 7a. Discoveries Page (New Top-Level Tab)

Add a `discoveries` tab to the existing SigDiscovery page (`/_discovery/{tab}`):

Route: `/_discovery/discoveries`

Components:
- **DiscoveriesTable** — list of all discoveries with columns: title, severity, relevance score (bar/badge), level, stream(s), created date, tags. Default sort: relevance_score descending.
- **DiscoveryDetailFlyout** — expanded view showing: description, relevance score with breakdown rationale, evidence (stream, query, feature, event count), sample events (collapsible JSON), cross-references (linked features, queries, child/parent discoveries as clickable links), recommendations
- **Filters** — severity, relevance score range (slider), level (0/1/2), stream, date range, semantic search input (uses `description_semantic` field)
- **Actions** — "Generate Meta-Discovery" (select multiple discoveries → create level+1 discovery), "Generate Suggestions" (from selected discoveries)

#### 7b. Suggestions Page (Inside SigDiscovery)

Add a `suggestions` tab to the SigDiscovery page:

Route: `/_discovery/suggestions`

Components:
- **"Generate Suggestions" button** — triggers a dedicated suggestion generation task (`streams_suggestion_generation`) that reads all persisted discoveries and runs only Stage 3. Uses the same task polling pattern as the Discoveries tab (schedule → poll → toast on completion). Cancel button shown during generation.
- **SuggestionsTable** — list of suggestions with columns: title, type (alert/dashboard/SLO/viz/investigation), priority, status, source discoveries
- **SuggestionDetailFlyout** — expanded view showing:
  - Title and description
  - ES|QL query with syntax highlighting (read-only code editor)
  - Reason (why this query was selected)
  - Source discoveries (clickable links to discovery detail)
  - "Open in Discover" button (opens ES|QL query in Discover)
  - "Copy query" button
- **Actions** — "Accept" (marks accepted, copies query), "Dismiss", "Re-generate"
- **Filters** — type (alert/dashboard/SLO/viz/investigation), priority, status (pending/accepted/dismissed)

Server-side: `POST /internal/streams/_suggestions/_task` (schedule/cancel/acknowledge) and `POST /internal/streams/_suggestions/_status` (poll). Task type: `streams_suggestion_generation`. Standalone function `generateSuggestionsFromDiscoveries()` reads all persisted discoveries and runs only the suggestion generation prompt (Stage 3).

#### 7c. Topology Tab (New)

Add a `topology` tab to the SigDiscovery page:

Route: `/_discovery/topology`

Components:
- **MermaidDiagram** — renders a Mermaid diagram generated by the LLM from stream features. Auto-generates when the tab is first opened. Includes fullscreen modal (90vw × 85vh) with scaling SVG.
- **"Regenerate" button** — re-triggers topology generation on demand.
- **Loading state** — spinner with description while the LLM generates the diagram.
- **Error state** — falls back to raw Mermaid source display if rendering fails.

Server-side: `POST /internal/streams/_topology` route. Fetches all features across all streams via `featureClient.getAllFeatures()`, summarizes them (id, title, type, subtype, stream_name, description, confidence), sends to the LLM via `inferenceClient.chatComplete()` with a system prompt instructing Mermaid `graph TD`/`graph LR` generation. Returns raw Mermaid code. The UI strips markdown fences and renders via lazy-loaded `mermaid` npm package.

#### 7d. Updated Route Config

```typescript
// In routes/config.tsx, update discovery tabs:
tabs: ['streams', 'features', 'queries', 'discoveries', 'suggestions', 'topology', 'settings']
```

**Commit plan:**
- Commit 22: Route config + tab additions (discoveries, suggestions, topology)
- Commit 23: DiscoveriesTable + DiscoveryDetailFlyout
- Commit 24: SuggestionsTable + SuggestionDetailFlyout + "Generate Suggestions" button with task polling
- Commit 25: TopologyTab with LLM-generated Mermaid diagram
- Commit 26: Settings tab UI

---

### Workstream 8: ES|QL STATS Support

**Goal:** Full ES|QL support including stats (aggregation) queries.

#### 8a. Query Schema Extension

In `@kbn/streams-schema`:
- Add `queryType?: 'row' | 'stats'` to `StreamQuery` (default `'row'`).
- Make `kql` optional when `queryType === 'stats'`.
- For stats queries, `esql.query` contains the full ES|QL (not derived from KQL).

#### 8b. Query Execution

In `executeEsqlRequest`:
- Detect query type from schema or by parsing ES|QL AST for STATS commands.
- Row queries: existing path (return `{ _id, _source }[]`).
- Stats queries: return `{ columns, values }` (raw tabular result).

#### 8c. LLM Generation

Update the `add_queries` tool schema to accept:
- `queryType: 'row' | 'stats'`
- `esql_query` (raw ES|QL, required when `queryType === 'stats'`)
- `kql` (required when `queryType === 'row'`)

Update prompts to explain when to use STATS (e.g., "Use stats queries when you need counts, averages, or groupings over time windows").

#### 8d. Rule Executor

For stats queries, the rule executor needs a different alerting model:
- **Threshold-based:** Fire when a stats value exceeds a threshold.
- **Change-based:** Fire when a STATS result changes significantly from baseline.

For the POC, stats query results are stored in the results data stream but may not create alerts (alerts are a stretch goal for STATS queries).

**Commit plan:**
- Commit 27: Query schema extension
- Commit 28: Execution path for STATS
- Commit 29: LLM generation updates for STATS
- Commit 30: Results storage for stats queries

---

## Implementation Order

**Every commit must pass the Validation Gate (see section below) before proceeding to the next.**

```
Phase 0: Insight → Discovery Migration (Workstream 0)
  Commits 0a-0d: Schema rename, pipeline rename, UI rename, telemetry/i18n
  Validate: type check all streams + streams_app tsconfigs, lint, run existing tests (they must still pass after rename)

Phase 1: Foundation (Workstreams 1, 8a)
  Commits 1-4, 27: Schema extensions (new Discovery fields), indices, semantic fields, query type extension
  Validate: type check all schema/plugin tsconfigs, run schema unit tests

Phase 2: Pipeline (Workstreams 2, 3)
  Commits 5-10: Three-stage pipeline, STATS execution, cross-refs, meta-discoveries, suggestions
  Validate: type check, lint, pipeline unit tests, cross-ref tests, suggestion tests

Phase 3: Agent Builder (Workstream 4)
  Commits 11-15: Namespace, tools, skills, agent, Mermaid
  Validate: type check agent_builder + streams tsconfigs, tool unit tests

Phase 4: Entity Store (Workstream 5)
  Commits 16-19: Entity Store enablement, entity mapping, push tool, list tool, maintainer
  Validate: type check, entity mapping unit tests

Phase 5: Settings & UI (Workstreams 6, 7)
  Commits 20-26: Settings, Discoveries page, Suggestions page (with Generate button), Topology tab
  Validate: type check streams_app tsconfig, lint, check_changes.ts

Phase 6: ES|QL STATS (Workstream 8b-d)
  Commits 28-30: Execution, generation, storage
  Validate: type check, extend execute_esql_request.test.ts, run all streams tests
```

---

## Plan Maintenance (Living Document)

This plan is a living document. It must be kept up to date during implementation so that it always reflects the current state of knowledge. If the plan needs to be re-executed later (e.g., after a rebase, by a different person, or by an AI agent), it should contain all learnings — not just the original intent.

### When to Update the Plan

Update `plans/2026-03-sig-events-offsite-poc.md` whenever:

1. **An approach doesn't work** — Document what was tried, why it failed, and what replaced it. Add an entry to the "Implementation Learnings" log below.
2. **A schema changes** — Update the TypeScript interfaces and index mappings in Workstream 1 to match what was actually implemented.
3. **A new dependency or constraint is discovered** — Update the Architecture Decisions table or the relevant workstream section.
4. **An open question is resolved** — Move it from "New Questions" to "Resolved Questions" with the answer.
5. **A commit plan changes** — If commits are reordered, split, or merged, update the commit plan in the affected workstream.
6. **An API or tool signature changes** — Update the tools table (4b) and any skills that reference it.

### How to Update

- Keep changes in-place (update the relevant section, don't append a separate "changelog" that duplicates information).
- For significant pivots, add a row to the Implementation Learnings log (below) so the reasoning is preserved.
- Commit plan updates alongside the code change they describe (same commit or immediately after).

### Implementation Learnings Log

Record significant deviations, failed approaches, and non-obvious discoveries here. Each entry should explain what was planned, what actually happened, and why.

| Date | Workstream | What Changed | Why |
|------|-----------|--------------|-----|
| 2026-03-02 | WS1 | `StorageIndexAdapter` used instead of `esClient.indices.create` for `.kibana_streams_discoveries` | `StorageIndexAdapter` provides managed lifecycle (template, alias, write index). `semantic_text` fields are deferred — they require either extending `StorageIndexAdapter` or a post-creation `putMapping` call. For the POC, basic fields are sufficient; semantic search can be added via `putMapping` in a follow-up commit. |
| 2026-03-02 | WS1 | `nested` type not supported by `StorageIndexAdapter` — used `object({ enabled: false })` for `evidence` and `recommendations` | `StorageIndexAdapter` types only support `keyword`, `text`, `long`, `date`, `boolean`, `object`. Nested queries are not needed for the POC since evidence/recommendations are read as whole arrays. If nested filtering is needed later, switch to direct index creation. |
| 2026-03-02 | WS1 | `feedback` field type mismatch — `null` not assignable to `string \| undefined` in StorageIndexAdapter | The `Discovery.feedback` type includes `null` but StorageIndexAdapter keyword fields expect `string \| undefined`. Fixed by coercing `null` to `undefined` on write (`feedback ?? undefined`). |
| 2026-03-02 | WS0 | `IStorageClient` vs `SimpleIStorageClient` — `Record<string, unknown>` fails type check | `IStorageClient<Settings, Doc>` requires exact type match between document type and storage schema. Must use `SimpleIStorageClient<Settings>` which derives the document type from settings. This is a non-obvious pattern — the FeatureClient uses `IStorageClient` with a custom `StoredFeature` type that exactly matches the schema. |
| 2026-03-02 | WS4 | Agent Builder `setup()` is synchronous — cannot use `await import()` | The Streams plugin `setup()` method is not async. Dynamic imports for Agent Builder registration must use `.then()` instead of `await`. |
| 2026-03-02 | WS4 | Only 5 of 11 planned tools added to allow list | The initial implementation focused on discovery-specific tools. The remaining 6 tools (`get_stream_features`, `upsert_features`, `get_sig_events_queries`, `upsert_sig_events_queries`, `get_sig_events_with_change_points`, `push_entity_definition`) need to be added to the allow list and registered via `agentBuilder.tools.register()`. |
| 2026-03-02 | WS4 | Tool implementations not registered | Allow list entries were added but `agentBuilder.tools.register()` was never called. Tools need actual implementation code that wraps the underlying services (DiscoveryClient, FeatureClient, QueryClient, etc.). This is the largest remaining gap. |
| 2026-03-02 | WS2/WS3 | Stage 3 (suggestion generation) not implemented | The pipeline currently returns `suggestions: []`. A third prompt stage needs to be added that takes enriched discoveries and generates ES\|QL query suggestions. |
| 2026-03-02 | WS8 | `query_type` uses `'row' \| 'stats'` instead of `'row' \| 'aggregation'` | The plan specified `'aggregation'` but the implementation used `'stats'` (matching the ES\|QL keyword). Plan updated to use `'stats'` throughout for consistency with ES\|QL terminology. |
| 2026-03-03 | WS1 | `semantic_text` field type added to `StorageIndexAdapter` | Extended `StorageMappingPropertyType` union, `StorageMappingProperty` union, `types` factory object, and `PrimitiveOf` mapping in `kbn-storage-adapter/types.ts`. This is a platform-level change that benefits all consumers. `semantic_text` fields use `inference_id` parameter (default `.elser-2-elasticsearch`). |
| 2026-03-03 | WS1 | Semantic fields added to discoveries index | Added `title_semantic`, `description_semantic`, `esql_query_semantic` to `storage_settings.ts` using `types.semantic_text({ inference_id: '.elser-2-elasticsearch' })`. `DiscoveryClient` write methods populate semantic fields by copying from source fields (e.g., `title_semantic = title`). Semantic search uses `{ semantic: { field, query } }` query type. |
| 2026-03-03 | WS4 | All 11 tools implemented and registered | Tools are created in `agent_builder/tools/` and registered via `agentBuilder.tools.register()` in `register_agent_builder.ts`. Tool handlers receive `StreamsToolsDependencies` which provides `getDiscoveryClient(request)` and `core` for lazy service instantiation. Some tools (e.g., `run_discovery_pipeline`) instantiate services inline since they need the full pipeline context. |
| 2026-03-03 | WS4 | 5 skills implemented | Added `extract-stream-features`, `generate-sig-events-queries`, `generate-suggestions`, `push-entity-definition` skills alongside the existing `generate-discoveries` skill. Each skill references the appropriate tool IDs. |
| 2026-03-03 | WS2/WS3 | Stage 3 (suggestion generation) implemented | Added `GenerateSuggestionsPrompt`, `suggestion_schema.ts`, and integrated Stage 3 into `generateDiscoveries()`. The pipeline now: Stage 1 (extract) → Stage 2 (enrich) → Stage 3 (generate suggestions). Suggestions are persisted via `DiscoveryClient.createSuggestion()`. Stage 3 failures are caught and logged without failing the entire pipeline. |
| 2026-03-03 | WS4 | `readSignificantEventsFromAlertsIndices` requires `queryClient` + `scopedClusterClient` | The function signature takes `(params, { queryClient, scopedClusterClient })`, not `esClient` directly. The `get_sig_events_with_change_points` tool instantiates `QueryService` to get a scoped `queryClient`. `from`/`to` must be `Date` objects, not strings. |
| 2026-03-03 | WS7 | Suggestions tab added to SigDiscovery page | New `SuggestionsTab` component at `components/suggestions/suggestions_tab.tsx`. Uses `GET /internal/streams/_suggestions` and `POST /internal/streams/_suggestions/{uuid}/_status` APIs. Shows type icon, priority badge, status badge, and flyout with ES\|QL code block. Accept/dismiss buttons update suggestion status. |
| 2026-03-03 | WS5 | Entity Store enablement uses index existence check, not HTTP API | Direct HTTP call to `POST /api/entity_store/enable` would require Security Solution plugin dependency. Instead, the Streams plugin checks for `.entities.v1.latest.*` indices on startup and logs a message if not found. The entity store must be enabled separately via Security Solution. |
| 2026-03-03 | WS8 | ES\|QL STATS execution path implemented | Added `queryType` field to `EsqlRuleParams`. The rule executor now branches: `row` queries use the existing `executeEsqlRequest` (expects `_id`/`_source` columns), `stats` queries use new `executeEsqlStatsRequest` (returns tabular results as key-value rows). STATS alerts store `stats_result` and `stats_columns` in `original_source`. |
| 2026-03-03 | WS4 | Mermaid rendering added to Agent Builder chat UI | New `mermaidLanguagePlugin` (parsing) and `MermaidRenderer` (rendering) in `markdown_plugins/`. The plugin intercepts ` ```mermaid ` code blocks and renders them via lazy-loaded `mermaid` npm package. Falls back to raw source display if the package is not available or rendering fails. |
| 2026-03-03 | WS1 | Sig events results data stream implemented | New `SigEventsResultsClient` at `lib/sig_events_results/results_client.ts`. Creates component template, index template, and data stream (`.streams.sig_events_results-default`) on first use. Supports `writeResult`, `writeResults` (bulk), and `searchResults` with filtering by `queryId`, `streamName`, `queryType`, and time range. |
| 2026-03-03 | WS1 | `DiscoveryClient.searchSuggestions` and `searchDiscoveries` crash when `params` is `undefined` | Route handlers pass `params.query` which can be `undefined` when no query string parameters are sent. Both methods now accept `params?` (optional) and use optional chaining (`params?.type`, `params?.size ?? 50`, etc.) throughout. Same defensive pattern should be applied to any client method called from a route with all-optional query params. |
| 2026-03-03 | WS6 | Settings page was static labels only — now has functional connector dropdowns | Replaced placeholder `EuiText` labels with `EuiSuperSelect` dropdowns that load available AI connectors via `useGenAIConnectors`. Each stage has its own selector with a "Use global default" option. Settings are loaded from `GET /internal/streams/_discovery/_settings` and saved via `PUT`. Uses existing `ConnectorIcon` for provider logos. |
| 2026-03-03 | WS4 | `resolveConnectorId` hardcoded fallback for POC | When no connector ID is provided and no global default is configured, `resolveConnectorId` now falls back to `anthropic-claude-4.6-sonnet` instead of throwing an error. This is a POC-only change — production code should require explicit configuration. |
| 2026-03-03 | WS4 | `get_stream_features` tool called non-existent `featureClient.getAssets()` | The `FeatureClient` method is `getFeatures(stream)` (returns `{ hits, total }`), not `getAssets()`. `getAssets()` exists on `QueryClient` but not `FeatureClient`. Fixed to `featureClient.getFeatures(streamName)` and destructure `{ hits: features }`. **Lesson:** Always verify the actual client API before writing tool wrappers — method names differ between clients. |
| 2026-03-03 | WS4 | `upsert_features` tool passed wrong argument shape to `featureClient.bulk()` | `FeatureClient.bulk()` takes two positional arguments `(stream: string, operations: FeatureBulkOperation[])`, not a single object `{ streamName, operations }`. Fixed to pass positional args. **Lesson:** `FeatureClient.bulk(stream, ops)` vs `QueryClient.bulk(definition, ops)` — different clients have different signatures. |
| 2026-03-03 | WS4 | `get_sig_events_with_change_points` tool failed with "Invalid time value" for relative times | The tool only handled literal `"now-1h"` and `"now"` strings. LLM passes values like `"now-24h"`, `"now-15m"`, `"now-7d"`. Added `parseRelativeTime()` helper that parses `now`, `now-Nd/h/m/s/w` patterns, and ISO date strings. |
| 2026-03-03 | WS7 | Discoveries tab did not show persisted discoveries | The `DiscoveriesTab` only showed discoveries from the in-memory pipeline task result. Discoveries created by the Agent Builder (via `create_discovery` tool) or persisted by the pipeline were invisible. Fixed: tab now fetches from `GET /internal/streams/_discoveries` and shows a table with severity, title, relevance, level, streams, and creation date. The `Summary` component (pipeline trigger) is shown above the table. |
| 2026-03-03 | WS2 | `generateDiscoveries` returned raw LLM output instead of persisted discoveries | The pipeline returned the raw extracted discoveries (without UUIDs/timestamps) even though it had already persisted them via `discoveryClient.createDiscovery()`. Fixed: now returns `persistedDiscoveries` (with proper `uuid`, `created_at`, `updated_at`) when available, falling back to raw output only if persistence was skipped. |
| 2026-03-03 | WS4 | `upsert_sig_events_queries` tool crashed with `Cannot read properties of undefined (reading 'filter')` | `queryClient.bulk()` takes `(definition: Streams.all.Definition, operations)` — a full stream definition as the first positional argument, not `{ streamName, operations }`. The definition is needed because `getIndexPatternsForStream(definition)` reads `definition.stream.ingest.routing` to build ES\|QL queries. Fix: added `getStreamsClient` to `StreamsToolsDependencies`, fetch the stream definition via `streamsClient.getStream(streamName)`, then pass it as the first argument. Also, `StreamQueryInput` requires an `id` field — added `uuidv4()` generation for each query. |
| 2026-03-03 | WS7 | Discovery detail flyout added to Discoveries tab | The Discoveries table had no detail view. Added `DiscoveryDetailFlyout` component that opens when clicking a row, showing: severity, description, relevance score, level, dates, streams, tags, evidence (with change point info), recommendations (with priority and steps), cross-references (queries, features, related discoveries), and feedback status. |
| 2026-03-03 | WS4 | Mermaid diagrams not rendering — plugin ordering + missing npm package | `esqlLanguagePlugin` ran before `mermaidLanguagePlugin` and converted all non-esql code blocks to `codeBlock` type, so the mermaid plugin never matched. Fix: reorder so `mermaidLanguagePlugin` runs first. Also, the `mermaid` npm package was not installed — added `mermaid@11.12.3` as a dependency. |
| 2026-03-03 | WS4 | Mermaid `getBBox is not a function` error | Mermaid v11's `render()` calls `getBBox()` on SVG elements, which requires them to be in a fully visible, laid-out DOM context. Off-screen containers (`left: -9999px`) and hidden containers (`visibility: hidden; height: 0`) all break it. Fix: render directly into the component's mounted `ref` container — a real visible `<div>` already in the page. |
| 2026-03-03 | WS4 | Mermaid diagrams too small inline + fullscreen modal | Mermaid renders SVGs with fixed pixel dimensions that are often small. Fix: CSS override `& svg { width: 100%; height: auto }` on the inline container so diagrams scale to fill the chat panel. Added fullscreen button that opens an `EuiModal` (90vw × 85vh) with the SVG scaled to fill. |
| 2026-03-03 | WS4 | `get_stream_features` tool failed with Zod validation errors for `feature.type` and `feature.id` | Some stored features in the `.kibana_streams_features` index are missing required fields (`type`, `id`), causing `featureClient.getFeatures()` to throw a Zod validation error. Fix: added a fallback path that does a raw ES search and manually maps the nested `feature.*` fields with defaults (`type: 'unknown'`, `id` from `uuid`/`_id`). Final filter removes any features still lacking valid `id` or `type`. |
| 2026-03-03 | WS7 | Discoveries tab simplified — removed flickering and dual data sources | The tab had two competing data sources: `Summary` component with in-memory `Insight[]` state and `DiscoveriesTab` fetching persisted discoveries from the API. This caused layout flickering. Simplified to a single layout: "Generate discoveries" button at top, persisted discoveries table below, flyout on click. Removed dependency on `Summary` component and its `queriesFetch` loading state. |
| 2026-03-03 | WS0 | Insight → Discovery rename completed on client side | Moved `components/insights/tab.tsx` to `components/discoveries/tab.tsx`. Renamed hook file `use_insights_discovery_api.ts` to `use_discovery_pipeline_api.ts`. Updated all imports in `page.tsx`, `streams_view.tsx`, and the new tab. Old `insights/` directory files (`summary.tsx`, `insight_card.tsx`, `feedback_buttons.tsx`) are now dead code — no longer imported. Server-side `insights/` directory names kept as-is (deeper infrastructure, variable names already use "Discovery"). |
| 2026-03-03 | WS4 | `promote_queries` tool added to Agent Builder | New tool wraps `queryClient.promoteQueries(definition, queryIds)` to create Kibana alerting rules from stored sig events queries. Takes `streamName` and optional `queryIds`; if no IDs given, promotes all unbacked queries for the stream. Added to allow list (now 12 tools total). |
| 2026-03-03 | WS3 | `investigation` suggestion type added | Added `'investigation'` to `SuggestionType` union for findings that need human follow-up but don't map to alert/dashboard/SLO/viz. Updated schema, Stage 3 prompt, and suggestions tab UI (label: "Investigation", icon: `folderCheck`). |
| 2026-03-03 | WS4 | `attachments.add` tool failing — LLM passing wrong type and field names | The tool's schema descriptions were too vague — LLM used `type: "json"` (doesn't exist) and omitted the required `content` field for `text` type. Fix: improved schema descriptions to explicitly list valid types (`text`, `esql`), required data shapes (`{ content: "..." }` for text), and a note that `json` type doesn't exist. |
| 2026-03-03 | WS3/WS7 | "Generate Suggestions" button added to Suggestions tab | Suggestions were previously only generated as Stage 3 of the discovery pipeline. Added a dedicated suggestion generation task (`streams_suggestion_generation`) that reads all persisted discoveries and runs only Stage 3 (suggestion generation). New routes: `POST /internal/streams/_suggestions/_task` and `POST /internal/streams/_suggestions/_status`. UI uses the same task polling pattern as the Discoveries tab. |
| 2026-03-03 | WS7 | Topology tab added to SigDiscovery page | New tab that generates a Mermaid diagram from stream features using LLM. Diagram is generated on-demand when the tab is first opened. Uses `POST /internal/streams/_topology` route that fetches all features via `featureClient.getAllFeatures()`, sends a summary to the LLM with a system prompt for Mermaid diagram generation, and returns the raw Mermaid code. UI renders the diagram using the same Mermaid rendering pattern as Agent Builder (lazy-loaded `mermaid` npm package, direct DOM rendering, fullscreen modal). |
| 2026-03-03 | WS4 | Features tab Zod validation crash on malformed documents | `FeatureService.migrateSource` used `.parse()` which throws on invalid documents. Some stored features are missing required fields (`type`, `id`, `uuid`, `properties`, `confidence`, `status`, `last_seen`). Fix: replaced `.parse()` with `.safeParse()` — if validation fails, apply defaults for all required fields (e.g., `type: 'unknown'`, `confidence: 0`, `status: 'active'`) and re-parse. This makes all feature reads resilient to malformed documents across all consumers (Features tab, Topology tab, Agent Builder tools). |
| 2026-03-03 | WS7 | Topology route `chatComplete` API requires `system` as top-level parameter | The initial implementation passed the system prompt as a message with `role: 'system'` in the `messages` array. The `inferenceClient.chatComplete()` API expects the system prompt as a top-level `system` parameter, and the `messages` array only accepts `MessageRole.User`, `MessageRole.Assistant`, and `MessageRole.Tool` roles. Passing `'system'` as a role caused an Internal Server Error. Fix: moved the system prompt to the `system` parameter and used `MessageRole.User` from `@kbn/inference-common` for the user message. **Lesson:** Always use the `MessageRole` enum (not string literals) and pass system prompts via the `system` parameter, not as a message. |

---

## Validation Gate (After Every Commit)

Every commit must leave the codebase in a valid, working state. Before creating each commit, run the following checks and fix any issues before proceeding:

### Mandatory Checks

```bash
# 1. Type check — scoped to the packages/plugins touched by the commit
yarn test:type_check --project <path/to/tsconfig.json>
# Run for each modified package/plugin. Examples:
#   yarn test:type_check --project x-pack/platform/packages/shared/kbn-streams-schema/tsconfig.json
#   yarn test:type_check --project x-pack/platform/plugins/shared/streams/tsconfig.json
#   yarn test:type_check --project x-pack/platform/plugins/shared/streams_app/tsconfig.json

# 2. Lint — only changed files
node scripts/eslint --fix $(git diff --name-only)

# 3. Unit tests — run tests for the modified package/plugin
yarn test:jest <path-to-test-file-or-directory>
# Examples:
#   yarn test:jest x-pack/platform/packages/shared/kbn-streams-schema/
#   yarn test:jest x-pack/platform/plugins/shared/streams/server/lib/discoveries/

# 4. Full validation script (catches cross-package issues)
node scripts/check_changes.ts
```

### Per-Commit Validation Checklist

| Check | What it catches | When to skip |
|-------|----------------|--------------|
| Type check (scoped) | Type errors in modified code | Never |
| Lint (changed files) | Style violations, unused imports | Never |
| Unit tests (scoped) | Broken logic, regressions | Never (write tests first or alongside) |
| `check_changes.ts` | Cross-package import issues, circular deps, missing exports | Can skip for schema-only commits if type check passes |

### Rules

1. **No commit may introduce type errors.** If a schema change in Commit 1 would break consumers, either update consumers in the same commit or make the new fields optional (and make them required in the commit that adds the consumer).
2. **No commit may introduce lint errors.** Fix them before committing.
3. **Every commit that adds logic must include tests.** Tests are listed in the Testing Strategy section below.
4. **Schema changes must be backward-compatible within the POC branch.** New fields should be optional or have defaults so that existing data doesn't break.
5. **If a commit adds a new API route, it must be callable.** Verify with a manual curl or a route test.

---

## Testing Strategy

The existing Streams plugin has ~36 unit test files but no tests for the discovery pipeline itself (only `verify_queries.test.ts` in significant_events). Each commit should include tests appropriate to its scope.

### Unit Tests (per commit)

| Commit | Test File | What to Test |
|--------|-----------|--------------|
| 0a (Schema rename) | `kbn-streams-schema/src/discovery/index.test.ts` | Verify renamed types compile; existing Insight-shaped data validates against Discovery schema (minus new required fields) |
| 0b (Pipeline rename) | `streams/server/lib/significant_events/discovery/generate_discoveries.test.ts` | Verify renamed pipeline function returns `DiscoveryPipelineResult`; mock LLM calls `submit_discoveries` tool |
| 1 (Schema extensions) | `kbn-streams-schema/src/discovery/index.test.ts` | Zod schema validation for Discovery (with relevance_score, recommendations, change_point evidence), Suggestion; relevance_score bounds (0–100); level bounds (0–2); required fields; cross-ref arrays |
| 2 (DiscoveryClient) | `streams/server/lib/discoveries/discovery_client.test.ts` | CRUD operations (create, get, search, update, delete); bi-directional ref updates; filtering by severity, relevance_score, level; semantic search query construction |
| 5 (Pipeline stages) | `streams/server/lib/significant_events/discovery/generate_discoveries.test.ts` | Mock LLM responses for each stage; verify discovery extraction with relevance_score; verify recommendations are embedded in discoveries; error handling (LLM timeout, invalid response, context overflow) |
| 6 (STATS execution) | `streams/server/lib/rules/esql/lib/execute_esql_request.test.ts` | Extend existing tests: aggregation query detection; tabular result parsing; handling of queries without `_id`/`_source` columns |
| 7 (Cross-refs) | `streams/server/lib/discoveries/cross_references.test.ts` | Bi-directional write; bulk update; orphan handling; concurrent update safety |
| 9 (Suggestions) | `streams/server/lib/suggestions/generate_suggestions.test.ts` | ES\|QL query generation from discoveries; type classification (alert/dashboard/SLO/viz); validation (syntax check); priority derivation from relevance_score |
| 10 (Suggestion CRUD) | `streams/server/lib/suggestions/suggestion_client.test.ts` | Create, list, accept, dismiss; status transitions; filtering by type/status |
| 12 (AB tools) | `streams/server/agent_builder/tools/*.test.ts` | Tool parameter validation; tool execution with mocked services; error responses |
| 16 (Entity mapping) | `streams/server/lib/entity_store/entity_mapping.test.ts` | Feature → Entity mapping for each type (host, user, service, generic); field mapping correctness; missing field handling |

### Integration Tests

| Scope | Test | What to Verify |
|-------|------|----------------|
| Discovery pipeline E2E | `streams/server/lib/significant_events/discovery/pipeline.integration.test.ts` | Full pipeline with mocked LLM: features → queries → discoveries (with relevance_score + embedded recommendations) → suggestions. Verify all cross-references are written bi-directionally. |
| Discovery API | `streams/server/routes/internal/streams/discoveries/route.test.ts` | HTTP API for CRUD + search; pagination; semantic search; filtering |
| Suggestion API | `streams/server/routes/internal/streams/suggestions/route.test.ts` | HTTP API for CRUD; status transitions; ES\|QL validation |

### What Tests Should Verify for Relevance Score

1. **Score is always present** — every Discovery from the pipeline has a `relevance_score` between 0 and 100.
2. **Score influences sort** — API returns discoveries sorted by relevance_score desc by default.
3. **Score is filterable** — API supports `min_relevance_score` parameter.
4. **Score is preserved through meta-discoveries** — meta-discoveries get their own score (not inherited from children).
5. **Score influences suggestion priority** — higher relevance_score discoveries produce higher-priority suggestions.

---

## Log Analytics Improvements

Beyond the core POC, these improvements would produce better log analytics outcomes.

### Temporal Analysis

The current pipeline analyzes a 15-minute window of alerts. For better discovery quality:

1. **Multi-window comparison** — Compare current window against a baseline (e.g., same time yesterday, same time last week). Discoveries that represent *changes* from baseline are more valuable than absolute counts.
2. **Trend detection** — Use ES|QL STATS with `BUCKET(@timestamp, ...)` to detect trends (increasing error rates, decreasing throughput) rather than just point-in-time snapshots.
3. **Time-of-day awareness** — The pipeline should know the current time context (business hours vs. off-hours) since the same pattern may have different severity depending on timing.

### Correlation Across Streams

The current pipeline processes streams independently. Cross-stream correlation would catch:

1. **Cascading failures** — Error in stream A (database) followed by errors in stream B (application) 30 seconds later.
2. **Shared infrastructure** — Multiple streams showing issues on the same host/pod/node.
3. **Service dependency chains** — Using `service.name` and `trace.id` to connect upstream and downstream effects.

**Implementation:** Add a correlation stage between Stage 1 (Extract Discoveries) and Stage 2 (Enrich with Recommendations) that groups discoveries by shared `stream_refs`, `feature_refs`, or temporal proximity.

### Feature Enrichment for Better Queries

The LLM generates better sig events queries when it has richer context:

1. **Field cardinality hints** — Before query generation, run `STATS count_distinct(field)` on key fields so the LLM knows which fields are useful for grouping vs. filtering.
2. **Value distribution samples** — Provide top-N values for key fields (e.g., top 10 `host.name` values, top 10 `status` codes) so the LLM generates queries with realistic values.
3. **Schema awareness** — Pass the stream's field mapping to the LLM so it knows available fields, their types, and can generate type-correct ES|QL.

**Implementation:** Extend the `get_stream_features` tool to optionally return cardinality and value distribution data alongside features. Add a `get_stream_schema` tool that returns the field mapping.

### Feedback Loop

Discoveries and suggestions improve over time with feedback:

1. **Discovery feedback** — Users can mark discoveries as "useful" or "not useful". This is stored and fed back into future pipeline runs as context ("previous discoveries the user found useful/not useful").
2. **Suggestion acceptance rate** — Track which suggestion types (alert/dashboard/SLO/viz) and which ES|QL patterns are most often accepted. Use this to bias future generation.
3. **False positive tracking** — If a suggested alert query fires too often, track this and reduce the relevance_score of the source discovery in future runs.

**Implementation (POC scope):** The `feedback` field (`'useful' | 'not_useful' | null`) is stored directly on the Discovery document. The pipeline prompt receives previous discoveries with their feedback as context so the LLM can learn from user preferences. Full feedback loop (acceptance rate tracking, false positive tracking) is post-POC.

### Additional Tools for Better Analysis (Post-POC)

These tools are not part of the core POC but would significantly improve discovery quality:

| Tool | Purpose | Benefit |
|------|---------|---------|
| `streams.get_stream_schema` | Return field mapping + cardinality for a stream | LLM generates type-correct, high-cardinality-aware queries |
| `streams.get_field_values` | Return top-N values for a field in a stream | LLM generates queries with realistic filter values |
| `streams.compare_time_windows` | Compare metrics between two time windows (default: same day; LLM can override via `baseline` param) | Enables trend-based discoveries ("error rate doubled since yesterday") |
| `streams.get_correlated_streams` | Find streams that share entities (hosts, services) with a given stream | Enables cross-stream correlation discoveries |

**Note:** The core POC already includes change point detection (`get_sig_events_with_change_points`), log pattern analysis (via `observability.get_log_groups`), and log rate analysis (via `observability.run_log_rate_analysis`) as tools available to the pipeline and agent. The tools above are additional enrichments for post-POC improvement.

---

## Resolved Questions

All questions have been resolved. Decisions are recorded here for reference.

| # | Question | Resolution |
|---|----------|------------|
| 1 | Discovery semantic search scope | **Global.** No space-aware scoping. |
| 2 | Cross-reference consistency | **Lazy on read.** When a feature/query is deleted, stale refs in discoveries are cleaned up when the discovery is read, not eagerly on delete. |
| 3 | Results data stream retention | **No retention management** in the POC. Data accumulates; cleanup is manual or post-POC. |
| 4 | Entity Store plugin dependency | **HTTP API calls** (`PUT /api/entity_store/entities/{entityType}`). No direct plugin dependency. |
| 5 | Entity type mapping | **LLM decides.** Map to `user`, `host`, or `service` when the LLM determines a match; everything else maps to `generic`. |
| 6 | Observability tool access | **Globally available.** All built-in tools are registered into a single `BuiltinToolRegistry` during setup. The SigDiscovery Agent can reference `observability.*` tool IDs without any dependency on the observability agent builder plugin. |
| 7 | Mermaid library | **`mermaid` npm package.** Lazy-load when a Mermaid code block is detected to avoid impacting initial bundle size. |
| 8 | Discovery pipeline trigger | **Manual only** for the POC (via UI button or Agent Builder). No scheduled runs. |
| 9 | Meta-discovery trigger | **Tool-based.** Expose discoveries as a searchable tool (`streams.search_discoveries`). When the LLM generates new discoveries, it can fetch existing ones via the tool and incorporate them — effectively creating meta-discoveries organically rather than through a separate trigger. |
| 10 | ES\|QL validation strictness | **Reject** invalid ES\|QL. Only syntactically valid queries are persisted as suggestions. |
| 11 | Suggestion deduplication | **Deduplicate** by ES\|QL query content. Before persisting, check if an identical query already exists; if so, update the existing suggestion's `discovery_refs` instead of creating a duplicate. |
| 12 | Baseline comparison window | **Same day** by default. The `compare_time_windows` tool accepts a `baseline` parameter so the LLM can override (e.g., "compare against yesterday", "compare against last week"). |
| 13 | Feedback persistence | **Discovery document itself.** Add a `feedback` field (`'useful' \| 'not_useful' \| null`) directly on the Discovery document. |
| 14 | Observability tool load order | **Safe — request-time resolution.** Agent Builder stores the raw agent definition at registration (only validates agent ID). The `configuration` function is called at request time (`toInternalDefinition` in `builtin/provider.ts`). Tool IDs are resolved during execution in `selectTools` → `pickTools` → `toolProvider.list({ request })`. By the time a user runs the agent, all plugins have loaded and registered their tools. No load-order issue. |
| 15 | Semantic text inference model ID | **Hardcode `.elser-2-elasticsearch`** — this is the standard inference endpoint for local development (ML node ELSER). Used by `sample_data_ingest`, `product_doc_base`, `security-labs-artifact-builder`, and Security test fixtures. If using EIS instead of ML nodes, use `.elser-2-elastic`. |
| 16 | Entity Store availability | **Enable on startup + add list tool.** The Entity Store is enabled via `POST /api/entity_store/enable`. The Streams plugin calls this during startup (in `start()`) to ensure the store is available. A new `streams.list_entities` tool wraps `GET /api/entity_store/entities/list` to let the LLM query entities. See updated Workstream 5 for details. |
| 17 | `get_log_patterns` implementation | **Use `categorize_text` aggregation directly** in the pipeline tool. The Agent Builder agent uses `observability.get_log_groups` for interactive chat. No duplication concern — the pipeline tool is a thin ES aggregation wrapper. |
| 18 | `Recommendation` persistence | **Embed in discovery.** Change `Discovery.recommendations` from `string[]` to `Recommendation[]` (the richer type with title, description, priority, steps, refs). Recommendations are stored as part of the discovery document, not as separate documents. |
| 19 | Change point data freshness | **Work with fresh data.** The pipeline should ensure sig events rules have run recently before analyzing change points. Trigger a rule execution check or wait for the latest alert cycle to complete before calling `get_sig_events_with_change_points`. |
| 20 | `run_log_rate_analysis` in pipeline | **Internal tool + Agent Builder.** Add `run_log_rate_analysis` as an internal pipeline tool (wrapping the same analysis logic) AND make it available to the Agent Builder agent via `observability.run_log_rate_analysis`. This gives the pipeline root-cause analysis capability. |
| 21 | `DiscoveryEvidence` naming convention | **Rename `Insight` → `Discovery`.** Since the existing `Insight` type is being replaced by `Discovery` (see Workstream 0), the naming convention conflict disappears. `DiscoveryEvidence` uses snake\_case to match the Elasticsearch mapping. The old `InsightEvidence` camelCase is removed. |

*(All open questions resolved — see Resolved Questions #17–21.)*

---

## Files Modified (Actual)

### Platform Packages
- `src/platform/packages/shared/kbn-storage-adapter/types.ts` — added `semantic_text` field type support

### Schema Package
- `x-pack/platform/packages/shared/kbn-streams-schema/src/discovery/index.ts` — new: Discovery, Suggestion, Recommendation, DiscoveryPipelineResult types; added `investigation` to SuggestionType union
- `x-pack/platform/packages/shared/kbn-streams-schema/src/insights/index.ts` — extended Insight type (kept for backward compat)
- `x-pack/platform/packages/shared/kbn-streams-schema/src/queries/index.ts` — queryType extension
- `x-pack/platform/packages/shared/kbn-streams-schema/index.ts` — exports for new types

### Streams Plugin (Server)
- `x-pack/platform/plugins/shared/streams/server/plugin.ts` — Agent Builder registration, Entity Store startup check, `StreamsToolsDependencies` wiring
- `x-pack/platform/plugins/shared/streams/server/lib/significant_events/discovery/generate_discoveries.ts` — three-stage pipeline (extract → enrich → suggest), returns persisted discoveries
- `x-pack/platform/plugins/shared/streams/server/lib/significant_events/discovery/prompts/` — system/user prompts for all 3 stages
- `x-pack/platform/plugins/shared/streams/server/lib/significant_events/discovery/schema.ts` — discovery Zod schema + submit_discoveries tool
- `x-pack/platform/plugins/shared/streams/server/lib/significant_events/discovery/suggestion_schema.ts` — suggestion Zod schema + submit_suggestions tool
- `x-pack/platform/plugins/shared/streams/server/lib/significant_events/discovery/utils.ts` — response extraction, query data collection
- `x-pack/platform/plugins/shared/streams/server/lib/discoveries/` — DiscoveryClient (CRUD, semantic search, cross-refs, deduplication), DiscoveryService, storage_settings, fields
- `x-pack/platform/plugins/shared/streams/server/lib/entity_store/entity_store_client.ts` — EntityStoreClient (list, push)
- `x-pack/platform/plugins/shared/streams/server/lib/sig_events_results/results_client.ts` — SigEventsResultsClient (data stream, write, search)
- `x-pack/platform/plugins/shared/streams/server/lib/rules/esql/types.ts` — added `queryType` to EsqlRuleParams
- `x-pack/platform/plugins/shared/streams/server/lib/rules/esql/executor.ts` — STATS execution path branching
- `x-pack/platform/plugins/shared/streams/server/lib/rules/esql/lib/execute_esql_stats_request.ts` — new: STATS query executor
- `x-pack/platform/plugins/shared/streams/server/lib/saved_objects/significant_events/discovery_settings.ts` — discovery settings saved object
- `x-pack/platform/plugins/shared/streams/server/routes/internal/streams/discoveries/route.ts` — discovery + suggestion CRUD routes
- `x-pack/platform/plugins/shared/streams/server/routes/internal/streams/discovery_settings/route.ts` — settings GET/PUT routes
- `x-pack/platform/plugins/shared/streams/server/routes/internal/streams/entity_store/route.ts` — entity store proxy routes
- `x-pack/platform/plugins/shared/streams/server/routes/utils/resolve_connector_id.ts` — hardcoded POC fallback connector
- `x-pack/platform/plugins/shared/streams/server/agent_builder/tools/` — 12 tool definitions (search_discoveries, get_discovery, create_discovery, run_discovery_pipeline, list_entities, get_stream_features, upsert_features, get_sig_events_queries, upsert_sig_events_queries, get_sig_events_with_change_points, push_entity_definition, promote_queries)
- `x-pack/platform/plugins/shared/streams/server/agent_builder/tools/promote_queries.ts` — new: promotes stored queries to active Kibana alerting rules
- `x-pack/platform/plugins/shared/streams/server/agent_builder/tools/types.ts` — StreamsToolsDependencies interface (added `getStreamsClient`)
- `x-pack/platform/plugins/shared/streams/server/agent_builder/tools/register_tools.ts` — centralized tool registration
- `x-pack/platform/plugins/shared/streams/server/agent_builder/skills/` — 5 skill definitions (generate_discoveries, extract_stream_features, generate_sig_events_queries, generate_suggestions, push_entity_definition)
- `x-pack/platform/plugins/shared/streams/server/agent_builder/agents/sig_discovery_agent.ts` — SigDiscovery agent definition
- `x-pack/platform/plugins/shared/streams/server/agent_builder/constants.ts` — tool/agent ID constants
- `x-pack/platform/plugins/shared/streams/server/agent_builder/register_agent_builder.ts` — orchestrates all registrations

### Streams Plugin (Server) — Feature Resilience
- `x-pack/platform/plugins/shared/streams/server/lib/streams/feature/feature_service.ts` — `migrateSource` uses `safeParse()` with default-patching for malformed documents (resilient to missing `type`, `id`, `uuid`, `properties`, `confidence`, `status`, `last_seen`)

### Streams Plugin (Server) — Suggestion Generation
- `x-pack/platform/plugins/shared/streams/server/lib/significant_events/discovery/generate_suggestions.ts` — new: standalone suggestion generation from persisted discoveries (Stage 3 only)
- `x-pack/platform/plugins/shared/streams/server/lib/tasks/task_definitions/suggestion_generation.ts` — new: `streams_suggestion_generation` task type
- `x-pack/platform/plugins/shared/streams/server/lib/tasks/task_definitions/index.ts` — registered suggestion generation task
- `x-pack/platform/plugins/shared/streams/server/routes/internal/streams/discoveries/route.ts` — added `POST _suggestions/_task` and `POST _suggestions/_status` routes

### Streams Plugin (Server) — Topology
- `x-pack/platform/plugins/shared/streams/server/routes/internal/streams/topology/route.ts` — new: `POST _topology` route, generates Mermaid diagram from features via LLM
- `x-pack/platform/plugins/shared/streams/server/routes/index.ts` — registered topology routes

### Streams App (UI)
- `x-pack/platform/plugins/shared/streams_app/public/components/significant_events_discovery/page.tsx` — added Suggestions, Topology tabs; updated imports for renamed files
- `x-pack/platform/plugins/shared/streams_app/public/components/significant_events_discovery/components/discoveries/tab.tsx` — (renamed from `insights/tab.tsx`) simplified: "Generate discoveries" button + persisted discoveries table + detail flyout on row click
- `x-pack/platform/plugins/shared/streams_app/public/components/significant_events_discovery/components/suggestions/suggestions_tab.tsx` — "Generate suggestions" button with task polling, SuggestionsTable with flyout, accept/dismiss; `investigation` type label + icon
- `x-pack/platform/plugins/shared/streams_app/public/components/significant_events_discovery/components/topology/topology_tab.tsx` — new: Topology tab with LLM-generated Mermaid diagram, auto-generates on tab open, fullscreen modal
- `x-pack/platform/plugins/shared/streams_app/public/components/significant_events_discovery/components/settings/settings_page.tsx` — functional connector dropdowns via EuiSuperSelect
- `x-pack/platform/plugins/shared/streams_app/public/components/significant_events_discovery/components/streams_view/streams_view.tsx` — updated import for renamed hook
- `x-pack/platform/plugins/shared/streams_app/public/hooks/use_discovery_pipeline_api.ts` — (renamed from `use_insights_discovery_api.ts`) React hook for discovery pipeline API
- `x-pack/platform/plugins/shared/streams_app/public/hooks/use_suggestion_pipeline_api.ts` — new: React hook for suggestion generation task API

### Agent Builder
- `x-pack/platform/packages/shared/agent-builder/agent-builder-common/base/namespaces.ts` — streams namespace
- `x-pack/platform/packages/shared/agent-builder/agent-builder-server/allow_lists.ts` — 12 streams tools + agent in allow list
- `x-pack/platform/plugins/shared/agent_builder/public/application/components/conversations/conversation_rounds/round_response/chat_message_text.tsx` — Mermaid rendering integration
- `x-pack/platform/plugins/shared/agent_builder/public/application/components/conversations/conversation_rounds/round_response/markdown_plugins/mermaid_plugin.tsx` — new: mermaid parsing + rendering (direct DOM render for getBBox, inline scaling, fullscreen modal)
- `x-pack/platform/plugins/shared/agent_builder/public/application/components/conversations/conversation_rounds/round_response/markdown_plugins/index.ts` — export mermaid plugin
- `x-pack/platform/plugins/shared/agent_builder/server/services/tools/builtin/attachments/attachment_add.ts` — improved schema descriptions to guide LLM on valid types and data shapes

---

## Dependency Graph

```
Workstream 0 (Insight → Discovery Migration)
    ↓
Workstream 1 (Schema Extensions + Persistence) ← depends on renamed types
    ↓
Workstream 8a (Query Type Extension)
    ↓
Workstream 2 (Three-Stage Pipeline) ← depends on schema + persistence
    ↓
Workstream 3 (Suggestions) ← depends on discoveries
    ↓
Workstream 4 (Agent Builder) ← depends on tools from pipeline
    ↓
Workstream 5 (Entity Store) ← depends on Agent Builder tools
    
Workstream 6 (Settings) ← independent, can parallel with 1-5
Workstream 7 (UI) ← depends on APIs from 2, 3, 6
Workstream 8b-d (ES|QL STATS) ← depends on schema from 8a
```
