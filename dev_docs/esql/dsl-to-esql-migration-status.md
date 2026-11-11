# DSL to ES|QL migration: status and hand-over

Status of the branch `dsl-to-esql-all`, based on elastic/kibana `main` at `c5c72294`
(2026-11-11). Read this before you pick the work up. The per-site ledger is
[`dsl-to-esql-migration-ledger.tsv`](./dsl-to-esql-migration-ledger.tsv) (one row per site, 574 rows).

## What this branch covers

The audit at `9eb3d2ee` (2026-11-06) classified 2,348 Query DSL sites in Kibana by verdict:

| Verdict (audit)                                                 | Sites                              | This branch               |
| --------------------------------------------------------------- | ---------------------------------- | ------------------------- | ------------- |
| `EASY_NOW`: migratable with Kibana-only changes                 | 574                                | attempted (table below)   |
| `KIBANA_WORK`: needs redesign in Kibana                         | 1,053                              | not attempted             |
| `ES_CHANGE`: needs an ES                                        | QL feature that does not exist yet | 185                       | not attempted |
| `KEEP_DSL`: by design (saved objects, write-by-query, EQL, ...) | 471                                | kept                      |
| `NOT_A_QUERY`                                                   | 65                                 | not a migration candidate |

The audit is 371 commits behind `main`. Every `EASY_NOW` site was re-located in current code,
and rows that were already gone or already ES|QL are marked in the ledger.

## Result of the `EASY_NOW` pass

| Status                                        | Sites |
| --------------------------------------------- | ----- |
| `MIGRATED`                                    | 340   |
| `SKIPPED` (kept as DSL, reason in the ledger) | 224   |
| `ALREADY_ESQL`                                | 8     |
| `GONE`                                        | 1     |
| `PARTIAL`                                     | 1     |

Skip reasons, from the ledger:

| Reason              | Sites | Meaning                                                                                                                                                                            |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `OTHER`             | 123   | Case-specific (see the ledger `note`). Mostly: a missing concrete index in `FROM`, hidden indices, unmapped fields, a response shape the callers depend on, a browser-side search. |
| `SHARED_HELPER`     | 75    | The site goes through a shared client or builder that has no ES                                                                                                                    | QL method, or is used by callers outside the chunk. |
| `SCRIPT`            | 9     | Runtime mappings or Painless (`G14`, `G15`).                                                                                                                                       |
| `KEEP_DSL`          | 8     | The same function also runs a DSL-only aggregation (categorize, significant terms, random sampler).                                                                                |
| `MISSING_INDEX_DEP` | 5     | Needs unknown-index handling, but the plugin cannot depend on `@kbn/storage-adapter`.                                                                                              |
| `OCC`               | 2     | Optimistic concurrency (`_seq_no`, `_primary_term`), gap `G07`.                                                                                                                    |
| `SCORING`           | 2     | Relevance scoring (`G39`).                                                                                                                                                         |

## Grouped limitations (what blocks the remaining DSL)

These are the reasons behind most skips. The gap IDs (`G..`) refer to the ES|QL capability
baseline in the vault at `Repositories/elastic/kibana/reports/2026-11-06-dsl-to-esql-analysis/`.

1. **Browser-side search has no ES|QL path.** `useEsSearch`, `useReduxEsSearch`, `useSyntheticsEsSearch`,
   `searchSource` and the `data.search` strategies send DSL from the UI. No client-side ES|QL hook exists.
   Fixing this needs a UI-side transport (`esql_async`) and changes to each consumer.
2. **Shared clients without an ES|QL method.** `InfraMetricsClient`, `DataStreamClient`,
   `AssetCriticalityDataClient`, `IRuleDataReader`, the legacy `callWithRequest` shim, the workflows data access
   layer, `ESSearchClient` and `logsClient`. Adding an `esql` method to each one unlocks its callers.
   `APMEventClient.esql` was added in this branch; the other clients still need theirs.
3. **Missing concrete indices.** `FROM a,b` fails with 400 `Unknown index` when any concrete name is
   missing, where the DSL with `ignore_unavailable` returned the rest (`G08`). Affects user-editable index
   lists and optional indices. Fix: pre-resolve the names, or use a wildcard that matches only existing indices.
4. **Hidden indices.** `expand_wildcards: all|hidden` cannot be expressed; `FROM` does not expand hidden
   indices (`G08`). Affects legacy `.siem-signals*`, `.lists*`, `.kibana-threat-reports*`, `.fleet-*`.
5. **Unmapped or dynamically mapped fields.** `KEEP`, `SORT` and `WHERE` fail with `Unknown column` where
   the DSL returned empty (`G19`). Affects customer-defined fields, `labels.*`, per-kind relationship fields.
6. **Runtime mappings and scripts.** Request-level `runtime_mappings`, `script` queries and Painless (`G14`, `G15`).
7. **Scoring and sampling.** `function_score`, `script_score`, `random_sampler`, `significant_terms`,
   `categorize_text` (`G24`, `G26`, `G27`, `G39`).
8. **Paging and concurrency.** `search_after` cursors that clients see, PITs and `_seq_no`/`_primary_term`
   (`G01`, `G07`).
9. **Histogram and bucket semantics.** Min/max or value counts on `histogram` fields, `_doc_count`
   (`G07`), empty buckets without explicit bounds (`G32`), `min_doc_count: 0` gap fill.
10. **Writes and non-search APIs.** `update_by_query`, `delete_by_query` (`G45`), saved-object `find`, EQL,
    suggesters. These stay DSL by design.
11. **Dead code and dev tooling.** Several sites have no callers, or are only used by tests or dev scripts.

## Behaviour changes to review before merge

Each migrated site keeps its external contract, except where the list below says otherwise.
These came from the per-chunk agent reports and are recorded per row in the ledger.

- **Exact counts replace capped ones.** Some counts that were capped at 10,000 hits, or at the default
  `terms` size of 10, now count everything (for example `use_total_count`, `crud.ts:840`, the APM
  `getCategoryStoppedPartitions`, the Lists overview).
- **Status codes for a missing index.** Some routes now return 400 where they returned 404 (for example
  the ML inference errors and pipeline-history reads, `platform_src_search` `home`, the APM
  `rule_query_inspector`, the File upload `index_searchable` route, which maps the 400 back to `notFound`).
- **Shape changes.** `getMonitoredUsers` returns `[{_id, username}]`, `get_slos_for_entity` returns a
  reduced `hits`, and `getSession` returns whole `_source` documents.
- **Semantics to double-check:**
  - `get_stacktraces_ids_field`: the old `should` ranked; the new `WHERE field IS NOT NULL | LIMIT 1` differs
    when the first document lacks the field.
  - `get_serverless_summary`: the Painless average is now `AVG(COALESCE(...) * COALESCE(...))`.
  - `rehydrate_process_selectors` (alertzero): a missing concrete plain index now fails the exit lookup, which
    is treated as "processes live".
  - `count_gate` (alertzero): depends on `allow_partial_results=false`.
  - `deprecation_logging`: `from` is no longer date math; an invalid date is now a 400.
  - `risk_engine` (security): the audit said cardinality, the code used `value_count`, so the port uses `COUNT(field)`.
  - `vspat` in File upload: the truncation warning can fire at exactly 10,000 rows.
  - `get_daily_data_generation` (profiling): now returns all indices, not the top 10.
  - `getAgentStats` (synthetics): now fails on a missing index or field, caught by the existing `.catch`.
- **Row caps.** Several ES|QL queries rely on the `LIMIT` and the 10,000-row result cap
  (`esql.query.result_truncation_max_size`). Check any site that needs more.
- **`unmapped_fields`.** Some queries use `SET unmapped_fields="nullify"` (GA 9.4+) to match the DSL behaviour for unmapped fields.

## Pre-existing issues found on the way (not fixed here)

- `apm/.../collect_data_telemetry/tasks.ts` (around line 904): the span-document count queries the transaction
  index, as the original DSL did, so the value is always 0.
- `proposals/server/services/proposals_service.ts:267`: `skipDiscardReason` is reported missing on
  `CreateProposalParams`, though the field is declared at HEAD in `proposals_storage.ts` and `create_proposal.ts`.
  The branch does not touch these lines. Check whether the error survives the corrected type check.

## Security review of ES|QL index names

The composer prints `from` names as unquoted ES|QL source text. A name with `|`, a comma, a quote or a
newline changes the query. A review traced about 200 non-literal `FROM` sources and fixed six that
came from request bodies or LLM output: `observability_agent_builder` (`toEsqlSources`, Boom 400),
`security_solution` (`isPlainEsqlSource`), `elastic_assistant` (`isPlainEsqlIndexPattern`,
`toEsqlSources`), `slo` (`remoteName`, `IllegalArgumentError`), `alertzero` (`isPlainEsqlSource`,
unsafe targets dropped) and `security_solution` `fetch_indices_doc_counts`. The rule is a plain-name
pattern, `^[A-Za-z0-9.*][A-Za-z0-9._*:+-]*$`, of at most 255 characters.

Not verified: public browser-side `from` calls (`logs-overview` `count_documents`, `security_solution`
`use_total_count`, `streams_app` `data_collector_actor`), which run under the user's own session; and the
kbn-discoveries dedupe `indexPattern`.

## Verification status

- **Unit and mock tests:** each chunk ran jest on the suites it touched, and the results are in the
  ledger's `tests` column. Several chunks ran whole directories. Tests that build a real ES client need
  `@jest-environment node`.
- **Live ES|QL:** only the Nightshift reads in PRs #64 and #66 were run against a local Elasticsearch
  (9.6.0-SNAPSHOT). The other migrated queries were checked against mocks and their query text, not against a
  cluster. Run the migrated sites against a cluster before you trust them (see "Next steps").
- **Type check:** see the section below.
- **Lint:** Prettier 2.8.8 and oxlint are clean on every changed file (no oxlint errors across 572 files).
- **Commits:** one commit per migrated chunk, plus the `APMEventClient` method first. Intermediate commits
  were not built on their own. Only the tip is verified.

### Type check

The worktree's `node_modules` is a symlink into the main checkout. A relative `@kbn/*` link then
resolves into the main checkout, which has stale types and no `esql` method on `APMEventClient`.
This gave false errors. The branch's own `node_modules` now maps every workspace package into the
worktree (`node_modules` is a real directory of symlinks, not a link to the main checkout).

Type-check result (per `tsconfig` project, `tsc -p <project> --noEmit`, 63 projects; the last project in
the list was skipped by a script bug, see below):

- The worktree reports 3,472 errors in worktree files. Most are in files this branch never touched
  (for example `kbn-unified-data-table` `tree_rows.tsx`, `task_store.ts`). The same project in the main
  checkout has no errors in the fleet files. The worktree is missing the built type outputs that
  `kbn bootstrap` creates, so the check is dominated by environment errors.
- 94 errors are in files the branch changed. Each one has the same message as errors in untouched files
  (for example `'e' is of type 'unknown'`), so they are most likely environment errors too. This is a
  heuristic, not a proof.
- **Not yet verified:** a differential check. Run the same sweep on the base commit (`c5c72294`) in a
  second worktree, then compare the error sets. Errors that appear only on the branch are the ones
  to fix.
- The sweep skipped the last project in its list (a missing trailing newline in the list file).
  Check it with the same command.

## Helper inventory and consolidation

About 40 files each define an unknown-index check and an `esql` read helper. Most could not depend on
`@kbn/storage-adapter`, which exports `isEsqlUnknownIndexError`. Examples: `apm/lib/helpers/esql_read.ts`,
`apm/lib/helpers/esql_apm.ts`, `apm/lib/helpers/esql_values.ts`, `apm_data_access/.../esql_unknown_index.ts`,
`fleet/services/esql_read.ts`, `security_solution/lib/esql/esql_read.ts`, `security_solution/utils/esql/esql_read.ts`,
`slo/services/utils/esql_read.ts`, `synthetics/lib/esql_read.ts`, `alerting/lib/esql_read.ts`.

Consolidating these into one shared package is the first follow-up. It needs a new package or a
dependency change, which this branch did not make.

Note: `unwrapEsResponse` wraps client errors in `WrappedElasticsearchClientError`. A check for the
unknown-index error that runs after it must unwrap `originalError` first. The APM client's check does this.
Any new helper that sits behind `unwrapEsResponse` needs the same step.

## Next steps (in this order)

1. **Type check:** run the differential check (see "Type check"): the same sweep on the base commit, then fix
   the errors that only the branch produces.
2. **Live validation:** run each migrated query against a cluster, for example with the local Elasticsearch
   build (`elasticsearch/build/distribution/local`). A parse error or an unknown column shows up there, not in mocks.
3. **Missing-index behaviour:** list every migrated call that tolerated a missing index in the DSL and check
   the ES|QL behaviour (400 vs empty) for each.
4. **Consolidate the helpers** (see the inventory above).
5. **Review the behaviour changes** (section above), then the skipped rows that are cheap to unblock:
   the `APMEventClient` `hidden` gap, and adding an `esql` method to `InfraMetricsClient`, `DataStreamClient`
   and `AssetCriticalityDataClient`.
6. **Start `KIBANA_WORK` (1,053 sites).** Pick by owner team, using the audit's `merged.tsv`. The audit
   data is outside the repository, in `~/Dev/ruflin/dsl-esql-audit-2026-11-06/`.

## Environment notes for whoever picks this up

- `node_modules` is linked to the main checkout. The branch rebuilt its own (see "Type check").
  Re-create it if you bootstrap a new worktree.
- The APM plugin's `jest.config.js` fails in a worktree that lacks `@openfeature/ofrep-web-provider`.
  That package is in `package.json` but missing from the main checkout's `node_modules`. A
  `node scripts/kbn bootstrap` in the main checkout should fix it (not tried in this branch). Until then, run
  jest with a temporary config that drops `setupFilesAfterEnv`.
- Run `node_modules/typescript/bin/tsc` with `NODE_OPTIONS=--max-old-space-size=16000`. The default
  heap runs out.
- The ledger in this folder has one row per site: `chunk`, `file`, `line`, `status`, `reason_code`,
  `note`, `files_changed`, `tests`. A row for a site migrated in a second pass shows the second-pass chunk
  (`apm_esql_A` and `apm_esql_B`).
