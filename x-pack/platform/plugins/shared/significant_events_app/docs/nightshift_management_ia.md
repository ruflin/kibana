# Nightshift Management information architecture

This document is the product and engineering record of the Nightshift Management
IA change in the `significant_events_app` plugin. Reviewers should not need the
chat history to understand jobs, routes, chrome, or what shipped versus what is
still planned.

Nightshift Management is the browser app at `/app/significant_events`. Nightshift
(the daily product) is a separate app at `/app/nightshift`.

## Jobs

| Surface | App route | Job |
| --- | --- | --- |
| Nightshift | `/app/nightshift` | Daily product. Operators start here. |
| Nightshift Management | `/app/significant_events` | Setup and review: data sources, knowledge indicators, events/rules/detections, memory. |
| Settings | `/app/significant_events/settings` | Operational controls: pause, limits, index patterns, tuning. Not a management tab. |

Settings is a sibling of the management chrome, not a fifth tab. Opening Settings
from the header menu hides the four management tabs and offers **Nightshift** plus
**Management** in the header instead.

## Landing URLs

Paths below are relative to `/app/significant_events` unless noted.

| Entry | Lands on |
| --- | --- |
| App `/` (no tab) | Data Sources (`/data_sources`) |
| Nightshift header **Management** | Significant Events (`/significant_events`) |
| Nightshift header **Settings** | `/settings` |
| Nightshift **Show all events** | `/significant_events` (deep link id `events`) |

Nightshift Management's own header includes **Nightshift** (back to
`/app/nightshift`) and **Settings** (or **Management** when already on Settings).

## Canonical paths

| Path | Chrome |
| --- | --- |
| `/data_sources` | Data Sources tab |
| `/knowledge_indicators/topology` | Knowledge Indicators → Topology |
| `/knowledge_indicators/queries` | Knowledge Indicators → Queries |
| `/knowledge_indicators/more` | Knowledge Indicators → More |
| `/significant_events` | Significant Events → Events |
| `/significant_events/rules` | Significant Events → Rules |
| `/significant_events/detections` | Significant Events → Detections |
| `/memory` | Memory tab |
| `/settings` | Settings page (header menu, no tab bar) |

`resolveManagementLocation()` in `common/tabs.ts` is the source of truth for
canonicalization. The share locator (`SIGNIFICANT_EVENTS_APP_LOCATOR_ID`) uses
the same helper, so deep links and in-app navigation stay aligned.

Settings remains a routeable `ManagementTab` so `/settings` and the locator
`tab: 'settings'` keep working. It is omitted from the tab bar in `page.tsx`.

## Redirects

In-app `RedirectTo` runs when `needsRedirect` is true. The locator emits the
canonical path directly (no extra hop).

| Requested path | Canonical path |
| --- | --- |
| `/` | `/data_sources` |
| `/streams` | `/data_sources` |
| `/knowledge_indicators` (no subtab) | `/knowledge_indicators/topology` |
| `/queries` | `/significant_events/rules` |
| `/detections` | `/significant_events/detections` |
| `/discoveries` | `/significant_events` (events list) |
| `/significant_events/events` | `/significant_events` |
| Unknown tab | `/data_sources` |
| Unexpected subtab on a flat tab (for example `/settings/extra`) | that tab with the subtab stripped |

Unknown Significant Events nested segments other than `events`, `rules`, and
`detections` also canonicalize to the events list.

## Chrome and IA decisions

### Management tabs

Four tabs, in this order:

1. **Data Sources**
2. **Knowledge Indicators**
3. **Significant Events**
4. **Memory**

Settings is a header-menu sibling, not a tab.

### Knowledge Indicators subtabs

| Subtab | Path | Contents |
| --- | --- | --- |
| Topology | `/knowledge_indicators/topology` | Entity, technology, infrastructure, and dependency KIs, plus the topology map |
| Queries | `/knowledge_indicators/queries` | Match-query and stats-query KIs. Promote is available here |
| More | `/knowledge_indicators/more` | Remaining types (schema, computed, rest) |

View membership is `matchesKnowledgeIndicatorView()` in
`get_knowledge_indicator_view.ts`. Topology types are `entity`, `technology`,
`infrastructure`, and `dependency`. Query types are match and stats queries.
More is everything else.

### Significant Events subtabs

Three separate subtabs:

| Subtab | Path | Contents |
| --- | --- | --- |
| Events | `/significant_events` | Events list. Canonical path has no nested `events` segment |
| Rules | `/significant_events/rules` | Created rules plus unpromoted query proposals with Promote |
| Detections | `/significant_events/detections` | Detections list |

### Find Significant Events

Lives on the Significant Events **parent chrome**, to the right of the three
subtabs (`SignificantEventsSubTabsChrome`). It is not inside the Events or
Detections toolbars, and it is not on Data Sources.

### Data Sources

- **Add Data Source** opens a popover; **Query stream** opens the create query
  stream flyout.
- There is no Find Significant Events control on this tab.
- **Generate** remains for KI onboarding of **selected streams**.

### Rules and Promote

- Rules shows unpromoted (draft) query proposals with a per-row **Promote**
  action (`RulesProposalsSection`).
- Promote also remains on Knowledge Indicators → Queries (row actions, bulk
  toolbar, and the details flyout).

### Topology chrome

- Collapsible map (`TopologyMapAccordion`) on Knowledge Indicators → Topology.
- **Generate topology** opens Agent Builder against **existing** knowledge
  indicators. It does not run feature identification or stream onboarding.
  Optional stream names from the KI filter narrow the prompt; empty selection
  searches existing KIs across accessible streams.

### Settings copy

The operational heading previously labeled **Data sources** is **Index
patterns**. That section is about matching streams for feature detection, not
the Data Sources management tab.

## Topology plan

Agreed approach: project stored topology KIs into a `TopologyGraph`. Do not
introduce a new stored KI type. The graph is a view, not a source of truth.

### Shipped on this branch

- `featuresToTopologyGraph()` in `@kbn/significant-events-schema` projects
  entity, technology, and infrastructure features to nodes. Dependency features
  become edges. Entity `technology` / `infraDeps` properties become computed
  edges. Excluded features are omitted. Unresolved dependency endpoints are
  listed, not invented as nodes.
- `TopologyMapAccordion` is a collapsible panel with type counts, empty and
  loading states, and an unresolved-endpoint callout. It re-projects the
  currently filtered topology KIs, so Generate topology fills the panel once
  those KIs update and the table refreshes.
- `TopologyMap` renders that graph with `@xyflow/react` and dagre layout inside
  the accordion (replaces the earlier stub). Node click selects the matching KI
  in the table.

Visualization details on this branch may still iterate (layout, node chrome,
unresolved-endpoint presentation). The projection contract above is the IA
decision to keep.

### Later / not on this branch

- Embed the same map later via a shared component and/or Agent Builder
  attachment. The management accordion is the first consumer, not a
  dashboard-embeddable blocker.
- Do not take a dependency on the APM service map for this view.
- Do not add a new stored KI type whose payload is the graph.
- Do not treat an SVG (or any rendered picture) as the source of truth.

## Implementation map

Paths are under `x-pack/platform/plugins/shared/` unless noted.

| Concern | File |
| --- | --- |
| Canonical tabs, subtabs, redirects | `significant_events_app/common/tabs.ts` |
| Route table (`/`, `/{tab}`, `/{tab}/{subtab}`) | `significant_events_app/public/routes/config.tsx` |
| In-app tab/subtab navigation helpers | `significant_events_app/public/hooks/use_management_route.ts` |
| Share locator | `significant_events_app/common/locators/significant_events_app_locator.ts` |
| App registration, deep links | `significant_events_app/public/plugin.tsx` |
| Management chrome, tabs, Settings header swap | `significant_events_app/public/pages/significant_events/page.tsx` |
| Shared subtab row (`extra` slot) | `significant_events_app/public/pages/significant_events/components/management_sub_tabs.tsx` |
| SE subtabs + Find Significant Events | `significant_events_app/public/pages/significant_events/components/significant_events_sub_tabs_chrome.tsx` |
| KI view membership (topology / queries / more) | `significant_events_app/public/components/knowledge_indicators/utils/get_knowledge_indicator_view.ts` |
| KI table, Topology accordion, Generate topology | `significant_events_app/public/pages/significant_events/components/knowledge_indicators_table/knowledge_indicators_table.tsx` |
| Generate topology (Agent Builder) | `significant_events_app/public/pages/significant_events/components/knowledge_indicators_table/generate_topology_button.tsx` |
| Topology graph projection | `x-pack/platform/packages/shared/kbn-significant-events-schema/src/topology_graph.ts` |
| Topology accordion + `@xyflow/react` map | `significant_events_app/public/components/knowledge_indicators/topology_map/` |
| Add Data Source + query stream flyout | `significant_events_app/public/pages/significant_events/components/streams_view/add_data_source_button.tsx` |
| Data Sources page (Generate + Add Data Source) | `significant_events_app/public/pages/significant_events/components/streams_view/streams_view.tsx` |
| Rules proposals + Promote | `significant_events_app/public/pages/significant_events/components/queries_table/rules_proposals_section.tsx` |
| Settings Index patterns heading | `significant_events_app/public/pages/significant_events/components/settings/tab.tsx` |
| Nightshift → Management / Settings | `x-pack/solutions/observability/plugins/nightshift/public/nightshift_page.tsx` |
| Nightshift → Show all events | `x-pack/solutions/observability/plugins/nightshift/public/app/app.tsx` |

## Tests covering this IA

- `significant_events_app/public/routes/tabs.test.ts` — redirect and canonical path matrix
- `significant_events_app/common/locators/significant_events_app_locator.test.ts` — locator paths, including legacy aliases
- `significant_events_app/public/pages/significant_events/components/significant_events_sub_tabs_chrome.test.tsx` — Find Significant Events on SE chrome
- `significant_events_app/public/pages/significant_events/components/significant_events_tab/significant_events_tab.test.tsx` — Find Significant Events is not on the Events toolbar
- `significant_events_app/public/pages/significant_events/components/streams_view/add_data_source_button.test.tsx` — Add Data Source → query stream flyout
- `significant_events_app/public/pages/significant_events/components/knowledge_indicators_table/generate_topology_button.test.tsx` — Agent Builder prompt uses existing KIs, not onboarding
- `kbn-significant-events-schema/src/topology_graph.test.ts` — graph projection
- Nightshift `nightshift_page.test.tsx` — Management href is `/app/significant_events/significant_events`; Settings href is `/app/significant_events/settings`
