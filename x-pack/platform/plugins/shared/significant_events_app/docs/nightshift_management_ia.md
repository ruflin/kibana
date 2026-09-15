# Nightshift Management information architecture

This file is the durable source of truth for the Nightshift Management IA
change. A reviewer should be able to understand jobs, routes, chrome, Data
Sources, Find Significant Events, topology (shipped vs later), implementation
files, and i18n without Slack or chat history.

Nightshift Management is the browser plugin `significant_events_app`
(`@kbn/significant-events-app-plugin`). The daily product is the separate
Nightshift app (`x-pack/solutions/observability/plugins/nightshift`).

Kibana app IDs:

| Product name | App id | `appRoute` |
| --- | --- | --- |
| Nightshift | `nightshift` (`NIGHTSHIFT_APP_ID`) | `/app/nightshift` |
| Nightshift Management | `significantEvents` (`SIGNIFICANT_EVENTS_APP_ID`) | `/app/significant_events` |

Availability for both surfaces is decided server-side by
`GET /internal/significant_events/availability`. When unavailable, Management is
hidden from global search and a direct visit shows
`SignificantEventsNotEnabledPrompt`. Nightshift navigates away to Observability
Overview.

---

## 1. Purpose / jobs to be done

| Surface | URL | Job |
| --- | --- | --- |
| **Nightshift** | `/app/nightshift` | Daily product. Operators start here: investigations, severity, “show all events”. |
| **Nightshift Management** | `/app/significant_events` | Setup and review: data sources, knowledge indicators, events/rules/detections, memory. |
| **Settings** | `/app/significant_events/settings` | Operational controls: pause, run limits, index patterns, tuning, apps, cleanup. **Not a management tab.** |

Settings is a header-menu sibling of the management chrome, not a fifth tab.
Opening Settings hides the four management tabs and swaps the header action from
**Settings** to **Management**.

### Landing

Paths below are relative to `/app/significant_events` unless noted.

| Entry | Lands on |
| --- | --- |
| App `/` (no tab) | Data Sources (`/data_sources`) |
| Nightshift header **Management** | `/significant_events` (Events list) |
| Nightshift header **Settings** | `/settings` |
| Nightshift **Show all events** | `/significant_events` (deep link id `events`) |

Nightshift Management’s own header always includes **Nightshift** (back to
`/app/nightshift`). On management pages the second item is **Settings**. On the
Settings page the second item is **Management**, pointing at
`/significant_events`. When Agent Builder is available, a third item **Tell us
about your system** starts the significant-events-onboarding skill.

Default management tab (`DEFAULT_MANAGEMENT_TAB`) is `data_sources`. Default
Knowledge Indicators subtab (`DEFAULT_KI_SUBTAB`) is `topology`.

---

## 2. Canonical paths

`resolveManagementLocation()` in `common/tabs.ts` is the source of truth.
`buildManagementPath()` turns a canonical `{ tab, subtab? }` into a URL path.
The share locator (`SIGNIFICANT_EVENTS_APP_LOCATOR_ID`) calls the same helper,
so deep links and in-app navigation stay aligned.

| Path | Chrome |
| --- | --- |
| `/data_sources` | Data Sources tab |
| `/knowledge_indicators/topology` | Knowledge Indicators → Topology |
| `/knowledge_indicators/queries` | Knowledge Indicators → Queries |
| `/knowledge_indicators/more` | Knowledge Indicators → More |
| `/significant_events` | Significant Events → Events (no nested `events` segment) |
| `/significant_events/rules` | Significant Events → Rules |
| `/significant_events/detections` | Significant Events → Detections |
| `/memory` | Memory tab |
| `/settings` | Settings page (header menu; no tab bar) |

Settings remains a routeable `ManagementTab` (`MANAGEMENT_TABS` includes
`settings`) so `/settings` and locator `tab: 'settings'` keep working. It is
omitted from the tab bar in `page.tsx`.

Significant Events → Events is the **parent** path `/significant_events`, not
`/significant_events/events`. Nested SE subtabs in the type system are only
`rules` and `detections` (`SIGNIFICANT_EVENTS_NESTED_SUBTABS`).

Optional query params (time range, search, status, type, subtype, stream,
`showComputed`, `selectedItem`, `selectedEvent`, `openEvent`) are defined on the
`/{tab}` and `/{tab}/{subtab}` routes. In-app redirects merge current query
params via `RedirectTo`, so aliases keep filters.

---

## 3. Redirects

In-app `RedirectTo` runs when `needsRedirect` is true (`page.tsx`). The locator
emits the canonical path directly (no extra hop). Unknown tabs fall through to
Data Sources.

| Requested path | Canonical path |
| --- | --- |
| `/` | `/data_sources` |
| `/streams` | `/data_sources` |
| `/knowledge_indicators` (no subtab) | `/knowledge_indicators/topology` |
| `/knowledge_indicators/<invalid>` | `/knowledge_indicators/topology` |
| `/queries` | `/significant_events/rules` |
| `/detections` | `/significant_events/detections` |
| `/discoveries` | `/significant_events` (events list) |
| `/significant_events/events` | `/significant_events` |
| `/significant_events/<unknown>` | `/significant_events` |
| Unknown tab | `/data_sources` |
| Unexpected subtab on a flat tab (for example `/settings/extra`) | that tab with the subtab stripped |

Legacy locator `tab` values still accepted: `streams`, `queries`, `detections`,
`discoveries`. Legacy locator `subtab` value `events` canonicalizes to the
events list.

### Deep links

Registered on the `significantEvents` app (global search when available):

| Deep link id | Title | Path |
| --- | --- | --- |
| `knowledge_indicators` | Significant Events / KIs | `/knowledge_indicators/topology` |
| `events` | Significant Events / Events | `/significant_events` |
| `rules` | Significant Events / Rules | `/significant_events/rules` |

There is no `detections` deep link id yet. Nightshift “Show all events” uses
`deepLinkId: 'events'`.

Related follow-up (not blocking this IA): the KI identification Agent Builder
tool still returns
`/app/significant_events/knowledge_indicators?stream=<name>`, which redirects
to Topology and keeps the `stream` query. Prefer emitting
`/knowledge_indicators/topology` explicitly when that tool is next touched.

---

## 4. Chrome / IA

### Four management tabs

Rendered by `SignificantEventsAppHeader` `tabs` on every management page except
Settings, in this order:

1. **Data Sources** → `/data_sources`
2. **Knowledge Indicators** → `/knowledge_indicators/topology`
3. **Significant Events** → `/significant_events`
4. **Memory** → `/memory`

Settings is **not** in this tab bar. Scout UI asserts the Settings tab count is
zero.

### Header-menu sibling

| Page | Header menu |
| --- | --- |
| Data Sources, Knowledge Indicators, Significant Events, Memory | Nightshift + **Settings** |
| Settings | Nightshift + **Management** (href `/significant_events`) |

Nightshift daily header is **Management** + **Settings** (no Nightshift
self-link in that pair). Test subjects:
`nightshiftManagementLink`, `nightshiftSettingsLink`,
`significantEventsSettingsLink`, `significantEventsManagementLink`.

### Knowledge Indicators subtabs

`ManagementSubTabs` with `data-test-subj="significantEventsKnowledgeIndicatorsSubTabs"`.

| Subtab | Path | KI types |
| --- | --- | --- |
| Topology | `/knowledge_indicators/topology` | `entity`, `technology`, `infrastructure`, `dependency` |
| Queries | `/knowledge_indicators/queries` | `match_query`, `stats_query` (stored query types `match` / `stats`) |
| More | `/knowledge_indicators/more` | Everything else: **schema**, computed/analysis types (`dataset_analysis`, `log_samples`, …) |

Membership is `matchesKnowledgeIndicatorView()` in
`get_knowledge_indicator_view.ts`. Topology types are
`TOPOLOGY_KI_TYPES`. Query types are `QUERY_KI_TYPES`. More is the remainder.

### Significant Events subtabs

`SignificantEventsSubTabsChrome` wraps `ManagementSubTabs` with
`data-test-subj="significantEventsSubTabs"`.

| Subtab | Path | Contents |
| --- | --- | --- |
| Events | `/significant_events` | Events list + event flyout |
| Rules | `/significant_events/rules` | Created rules (`QueriesTable`) plus unpromoted draft proposals (`RulesProposalsSection`) with Promote |
| Detections | `/significant_events/detections` | Detections list + detection flyout |

Promote also remains on Knowledge Indicators → Queries (row actions, bulk
toolbar, details flyout). Auto-promote is out of scope.

### Topology KI types vs graph edge kinds

Do not confuse table types with graph edge kinds:

- **Table / IA types on Topology:** entity, technology, infrastructure,
  dependency.
- **Graph nodes:** entity, technology, infrastructure only.
- **Graph edges:** `dependency` (from dependency KIs) and `computed` (from
  entity `technology` / `infraDeps` properties). Computed **edges** are a
  projection, not a stored KI type, and are not the “computed” items that live
  on the More subtab.

---

## 5. Data Sources changes

Data Sources is `StreamsView`.

**Removed from this tab:** Find Significant Events.

**Add Data Source** (`significantEventsAddDataSourceButton`) opens a popover
(`Add Data Source` → **Query stream**). Choosing Query stream opens
**Create query stream** flyout (`CreateQueryStreamFlyout`).

Create flow:

1. Name (max 255) and ES\|QL query (max 10_000).
2. `streamsRepositoryClient.fetch('PUT /api/streams/{name}/_query 2023-10-31', { params: { path: { name }, body: { query: { esql } } } })`.
3. Invalidate `STREAM_LIST_QUERY_KEY` (`['streamList']` from
   `use_fetch_streams.ts`).
4. Success toast “Query stream created”; flyout closes.

**Per-row Enabled toggle** (`significantEventsStreamEnabledSwitch-<streamName>`):
classic and query streams both get an EUI switch. Turning a stream **on**
persists it in the Nightshift/KI allowlist
(`observability:streamsSigEventsEnabledStreams`) and starts KI extraction for
**that stream only** (same pipeline as Generate: features identification +
queries generation via `POST /internal/streams/{streamName}/onboarding/_execute`
`action: schedule`). Turning a stream **off** removes it from the allowlist and
cancels an in-flight onboarding job (`action: cancel`) so continuous extraction
does not pick it up again.

The allowlist is space-scoped uiSettings (same store as index patterns), not a
new saved-object type. Until the user first toggles a stream, the switch is
seeded from KI onboarding status (`completed` / `in_progress` / `failed` /
`being_canceled` = on; `not_started` / `canceled` = off) so already-onboarded
streams stay on after reload.

Status / KI Features / KI Queries columns still reflect extraction progress and
errors. The per-row radar action remains as an explicit **re-run** for
already-enabled streams (stop while in progress). The toolbar **Generate** split
button and row selection were removed from Data Sources; they competed with the
toggle as the enable path. Generate remains on Knowledge Indicators.

---

## 6. Find Significant Events placement

Moved **out of** the Events and Detections table toolbars. Data Sources no
longer hosts it either.

It now lives on the Significant Events **parent chrome**, to the right of
Events / Rules / Detections, and is therefore visible on all three SE subtabs.

How it is wired:

- `ManagementSubTabs` accepts an optional `extra` slot (`ReactNode`) aligned on
  the same row as the tabs, outside the tab list.
- `SignificantEventsSubTabsChrome` passes `FindSignificantEventsButton` as
  `extra`.
- The button is a split control: primary **Find Significant Events** runs
  discovery; the menu **Cancel** stops an in-progress run. Pause/status from
  `useBlocksNewActivity()` disables start (`isDisabled={isRunning || blocksActivity}`).
- Default test id: **`significant_events_discovery_button`**. Related:
  `significant_events_discovery_options_trigger`,
  `significant_events_cancel_discovery_button`,
  `significant_events_discovery_split_button`.

**Still not** on Data Sources, Knowledge Indicators, Memory, or Settings.

`SignificantEventsTab` asserts the discovery button is absent from the Events
toolbar. `SignificantEventsSubTabsChrome` asserts it is present on the SE
subtab row.

---

## 7. Topology visualization plan

Agreed approach: project **stored** topology knowledge indicators into a
`TopologyGraph`. The graph is a view, not a source of truth. Do not invent a
new stored KI type whose payload is the graph.

### Slice 1 — shipped on this branch

1. **`featuresToTopologyGraph`** (`@kbn/significant-events-schema`) builds
   nodes from non-excluded `entity` / `technology` / `infrastructure` features,
   and edges from `dependency` features (`properties.source` or `.from` →
   `properties.target` or `.to`). Entity `properties.technology` and
   `properties.infraDeps` become `kind: 'computed'` edges. Self-loops and
   duplicate pairs are dropped. Excluded features are omitted.
2. **Endpoint resolution order:** `feature.id` → `uuid` →
   `properties.name` (case-insensitive) → `title` (case-insensitive).
   Unresolved **dependency** endpoints are listed on
   `graph.unresolvedEndpoints` and stay dangling (no invented nodes, no edge).
   Unresolved computed refs are skipped silently (no unresolved callout).
   Node label is `title` ?? `properties.name` ?? `feature.id`. Node id is the
   feature uuid.
3. **Render** with `@xyflow/react` (`TopologyMap`) and **client-side dagre**
   (`applyDagreLayout`, `@dagrejs/dagre`, left-to-right). This **replaces the
   accordion stub**. Collapse, type counts, empty state, loading state, and
   unresolved-endpoint callout stay on `TopologyMapAccordion`. Computed edges
   are drawn dashed/dimmed; dependency edges are solid with an arrow. Nodes are
   not draggable or connectable. Interactive pan/zoom and Controls are on by
   default.
4. **Node click** selects the matching KI (`feature.uuid === node.id`) via the
   existing table/flyout selection (`selectKnowledgeIndicator`). Selected node
   id tracks `selectedKnowledgeIndicatorId`.
5. **Generate topology** injects selected **KI filter** stream names
   (`selectedStreams` from the knowledge indicators table URL/filter state,
   not the onboarding StreamPicker) into the Agent Builder prompt. Empty
   selection searches existing KIs across accessible streams. The prompt
   explicitly forbids feature identification and stream onboarding.

`TopologyMapAccordion` re-projects the **currently filtered** topology KIs, so
Generate topology fills the panel once those KIs update and the table
refreshes.

### Later slices — do not block this PR

These are planned consumers of the same `TopologyGraph` / map, not shipped:

- Agent Builder attachment of the topology map
- Nightshift daily flyout embed
- Dashboard embeddable
- Agent write-back of implied knowledge indicators (the Generate topology
  prompt already asks before creating KIs that existing ones do not support;
  there is no automatic write-back)

The management accordion is the first consumer, not a dashboard-embeddable
blocker.

### Out of scope

- APM service map, Maps, Lens, or Cloud Security Posture as dependencies
- Treating an SVG (or any rendered picture) as the source of truth
- A new stored KI type whose payload is the graph
- Auto-promote of query proposals

---

## 8. Implementation map

Paths are under `x-pack/platform/plugins/shared/significant_events_app/` unless
noted.

### Routing helpers

| Concern | File |
| --- | --- |
| Canonical tabs, subtabs, redirects | `common/tabs.ts` |
| Re-export for public code | `public/routes/tabs.ts` |
| Route table (`/`, `/{tab}`, `/{tab}/{subtab}`) | `public/routes/config.tsx` |
| In-app tab/subtab `link` / `push` / `replace` | `public/hooks/use_management_route.ts` |
| Redirect that preserves query params | `public/components/redirect_to/index.tsx` |
| App route constant | `../significant_events/common/constants.ts` (`SIGNIFICANT_EVENTS_APP_ROUTE`) |

### Locator and deep links

| Concern | File |
| --- | --- |
| Share locator | `common/locators/significant_events_app_locator.ts` |
| Locator id | `src/platform/packages/shared/deeplinks/observability/locators/significant_events.ts` |
| App id | `src/platform/packages/shared/deeplinks/observability/constants.ts` |
| App registration + deep links | `public/plugin.tsx` |
| Nightshift → Management / Settings | `x-pack/solutions/observability/plugins/nightshift/public/nightshift_page.tsx` |
| Nightshift header menu | `x-pack/solutions/observability/plugins/nightshift/public/app/app_header.tsx` |
| Nightshift → Show all events | `x-pack/solutions/observability/plugins/nightshift/public/app/app.tsx` |

### Chrome

| Concern | File |
| --- | --- |
| Page: tabs, KI/SE subtabs, Settings header swap, redirects | `public/pages/significant_events/page.tsx` |
| Shared subtab row (`extra` slot) | `public/pages/significant_events/components/management_sub_tabs.tsx` |
| SE subtabs + Find Significant Events | `public/pages/significant_events/components/significant_events_sub_tabs_chrome.tsx` |
| Find Significant Events control | `public/pages/significant_events/components/streams_view/find_significant_events_button.tsx` |
| KI view membership | `public/components/knowledge_indicators/utils/get_knowledge_indicator_view.ts` |

### Data Sources / Add Data Source

| Concern | File |
| --- | --- |
| Data Sources page (Enabled toggle + Add Data Source) | `public/pages/significant_events/components/streams_view/streams_view.tsx` |
| Per-row Enabled switch | `public/pages/significant_events/components/streams_view/stream_enabled_switch.tsx` |
| Enabled allowlist persist + KI start/cancel | `public/pages/significant_events/hooks/use_nightshift_stream_enabled.ts` |
| Add Data Source popover | `public/pages/significant_events/components/streams_view/add_data_source_button.tsx` |
| Create query stream flyout + PUT | `public/pages/significant_events/components/streams_view/create_query_stream_flyout.tsx` |
| Stream list query key | `public/pages/significant_events/hooks/use_fetch_streams.ts` |
| Generate split button (KI table only) | `public/pages/significant_events/components/shared/generate_split_button.tsx` |
| Enabled-streams setting parse | `../significant_events/common/enabled_streams.ts` |
| Continuous extraction respects allowlist | `../significant_events/server/routes/internal/knowledge_indicators/extraction/classify_streams.ts` |

### Topology

| Concern | File |
| --- | --- |
| Graph projection | `x-pack/platform/packages/shared/kbn-significant-events-schema/src/topology_graph.ts` |
| Schema public export | `x-pack/platform/packages/shared/kbn-significant-events-schema/index.ts` |
| Accordion (counts, empty/loading, unresolved) | `public/components/knowledge_indicators/topology_map/topology_map_accordion.tsx` |
| `@xyflow/react` canvas | `public/components/knowledge_indicators/topology_map/topology_map.tsx` |
| Node chrome | `public/components/knowledge_indicators/topology_map/topology_node.tsx` |
| Client dagre layout | `public/components/knowledge_indicators/topology_map/apply_dagre_layout.ts` |
| KI table, map host, node click | `public/pages/significant_events/components/knowledge_indicators_table/knowledge_indicators_table.tsx` |
| Generate topology (Agent Builder) | `public/pages/significant_events/components/knowledge_indicators_table/generate_topology_button.tsx` |
| Generate topology prompt copy | `public/pages/significant_events/components/knowledge_indicators_table/translations.ts` |

### Other surfaces

| Concern | File |
| --- | --- |
| Events list (no Find Significant Events) | `public/pages/significant_events/components/significant_events_tab/index.tsx` |
| Rules + proposals | `public/pages/significant_events/components/queries_table/queries_table.tsx`, `rules_proposals_section.tsx` |
| Detections list | `public/pages/significant_events/components/detections_tab/index.tsx` |
| Settings (pause, limits, index patterns, tuning) | `public/pages/significant_events/components/settings/tab.tsx` |
| Settings pause | `public/pages/significant_events/components/settings/maintenance_section.tsx` |

The Settings heading previously labeled **Data sources** is **Index patterns**.
That section matches streams for feature detection; it is not the Data Sources
management tab.

### Tests covering this IA

| File | What it locks |
| --- | --- |
| `public/routes/tabs.test.ts` | Redirect and canonical path matrix |
| `common/locators/significant_events_app_locator.test.ts` | Locator paths, including `/streams`, KI default topology, `/queries` → rules |
| `public/pages/significant_events/components/management_sub_tabs.test.tsx` | `extra` slot sits outside the tab list |
| `public/pages/significant_events/components/significant_events_sub_tabs_chrome.test.tsx` | Find Significant Events on SE chrome (`significant_events_discovery_button`) |
| `public/pages/significant_events/components/significant_events_tab/significant_events_tab.test.tsx` | Discovery button absent from Events toolbar |
| `public/pages/significant_events/components/streams_view/add_data_source_button.test.tsx` | Add Data Source → Query stream → PUT `/api/streams/{name}/_query 2023-10-31` |
| `public/pages/significant_events/components/streams_view/streams_view.test.tsx` | Generate absent from Data Sources chrome |
| `public/pages/significant_events/hooks/use_nightshift_stream_enabled.test.tsx` | Allowlist persist, seed from onboarding, enable starts extraction, disable cancels |
| `public/pages/significant_events/components/knowledge_indicators_table/generate_topology_button.test.tsx` | Prompt uses existing KIs, injects stream names, no onboarding |
| `public/components/knowledge_indicators/utils/get_knowledge_indicator_view.test.ts` | Topology / Queries / More type membership |
| `public/components/knowledge_indicators/topology_map/topology_map_accordion.test.tsx` | Counts, empty/loading, unresolved endpoints, canvas present |
| `public/components/knowledge_indicators/topology_map/apply_dagre_layout.test.ts` | Client dagre positions |
| `kbn-significant-events-schema/src/topology_graph.test.ts` | Graph projection, resolution order, dangling endpoints, computed edges |
| `test/scout/ui/tests/significant_events.spec.ts` | `/` → `/data_sources`; four tabs; Settings not a tab |
| Nightshift `public/nightshift_page.test.tsx` | Management href `/app/significant_events/significant_events`; Settings `/app/significant_events/settings` |

---

## 9. i18n

- Nightshift Management (this plugin): message IDs use
  **`xpack.significantEventsApp.*`**.
- Nightshift daily app: message IDs use **`xpack.nightshift.*`**.
- Never abbreviate “significant” in identifiers, filenames, folders, i18n ids,
  or test subjects. Use `significantEvent` / `significant_event` only. Search
  keywords on the app registration may still include the user-facing alias
  “sig events”.
- User-visible labels keep “Significant Events” fully spelled (Find Significant
  Events, tab name, Settings pause copy, toasts).

---

## What this IA is not

- It does not change Nightshift daily investigations UX beyond header landing
  URLs.
- It does not move Settings into the management tab bar.
- It does not put Find Significant Events back on Data Sources or inside Events
  / Detections toolbars.
- It does not make the topology map an Agent Builder attachment, Nightshift
  flyout, or dashboard embeddable in this change.
- It does not auto-promote rules or invent a stored topology-graph KI type.
