# Significant Events Plugin — Agent Context

Significant Events is the name for a set of functionalities meant to derive useful information from Streams, related to incident monitoring, investigation and remediation.

It used to be part of the Streams plugin, now it is in its own dedicated plugin.

## Naming conventions

Never abbreviate "significant" in identifiers, file names, or folder names:

| ✅ Correct            | ❌ Avoid      |
| --------------------- | ------------- |
| `significantEvent`    | `sigEvent`    |
| `SignificantEvent`    | `SigEvent`    |
| `significant_event_*` | `sig_event_*` |
| `SIGNIFICANT_EVENT_*` | `SIG_EVENT_*` |

As Significant Events used to be co-located inside Streams, a lot of symbols were prefixed with `SignificantEvents`. Now that there is a separate plugin, consider removing it.

The guideline is: if a concept is meant to be used outside the context of the plugin, consider prefixing it with `SignificantEvents` or `significantEvents`. If it is not, it is safe to not include the prefix.

When something is related to the Knowledge Indicator (KI) system, it should be indicated as such. `KnowledgeIndicator` (or `knowledgeIndicator`), or the use of `KI` are ok. `Ki` is not.

## Alerting v2 bridge

Significant Events keep their own store (`.significant_events-events`). They are linked to Alerting v2, not merged:

- **Direction A:** a successful event write / status change promotes the incident to an Alerting v2 episode via `getAlertEventsClientWithRequest().createAlertEvent`, with `source: 'significant_events'` and `fingerprint: event_id`. KI match-count rules stay `kind: signal` and are never converted to alert rules.
- **Direction B (join-only):** user `kind: alert` episodes can attach as `type: 'alerting_v2_episode'` signals on an **already open** significant event. Do not auto-create events from orphan alerts. Loop filters drop `source=significant_events` and `sigevents:metric:match_count`.

Helpers live under `server/lib/significant_events/alerting/`.

## Keeping this file current

Update this file when you make a change that would mislead an agent reading it: cross-package ownership changes, pipeline restructuring, addition or removal of concepts relevant to the pipeline, or naming convention updates. Do not update it for type field additions or directory reorganisations within a package — those are discoverable from the code.
