/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EVENT_OUTCOME, EXCEPTION_MESSAGE, EXCEPTION_TYPE, URL_FULL } from '@kbn/apm-types';
import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import { CORE_WEB_VITALS, type CoreWebVital } from '../../common/core_web_vitals';
import {
  EVENT_CLICK,
  EVENT_DOCUMENT_LOAD,
  EVENT_EXCEPTION,
  EVENT_NAVIGATION,
  EVENT_USER_ACTION_CLICK,
  EVENT_WEB_VITAL,
  WEB_VITAL_NAME,
  WEB_VITAL_VALUE,
} from '../../common/otel_data';
import {
  SESSIONS_INDEX_PATTERN,
  SESSIONS_SOURCE_INDICES,
  emptyWebVitals,
  toPagePath,
  type SessionDetailResponse,
  type SessionPageVisit,
  type SessionSummary,
  type SessionTimelineEvent,
  type SessionTimelineEventKind,
} from '../../common/sessions';
import { esqlRows, runEsqlRead } from '../lib/esql_read';
import { toSessionSummary, type SessionDocument } from './list_sessions';
import { SOURCE_SERVICE_NAME_FIELD, SOURCE_SESSION_ID_FIELD } from './source_fields';

/** Max raw events loaded for the session timeline. */
export const SESSION_TIMELINE_SIZE = 1000;
/** Widens the raw event window so events just before the summary start are not cut off. */
const TIMELINE_SLACK_MS = 60_000;

export interface OtelSource {
  '@timestamp'?: string;
  name?: string;
  event_name?: string;
  duration?: number;
  trace_id?: string;
  span_id?: string;
  attributes?: Record<string, unknown>;
  resource?: { attributes?: Record<string, unknown> };
}

const getNested = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>(
    (current, key) =>
      current && typeof current === 'object'
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value
  );

/** Reads an attribute stored either under a dotted key or as nested objects. */
const attribute = (bag: Record<string, unknown> | undefined, key: string): unknown =>
  bag?.[key] ?? getNested(bag, key.split('.'));

const attributeString = (source: OtelSource, key: string): string | null => {
  const value = attribute(source.attributes, key) ?? attribute(source.resource?.attributes, key);
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
};

const attributeNumber = (source: OtelSource, key: string): number | null => {
  const value = Number(attributeString(source, key));
  return attributeString(source, key) != null && Number.isFinite(value) ? value : null;
};

const eventNameOf = (source: OtelSource): string => source.event_name ?? source.name ?? '';

const pageOf = (source: OtelSource): string | null =>
  toPagePath(attributeString(source, URL_FULL) ?? attributeString(source, 'http.url'));

const webVitalOf = (source: OtelSource): { name: CoreWebVital; value: number } | null => {
  if (eventNameOf(source) !== EVENT_WEB_VITAL) {
    return null;
  }
  const name = attributeString(source, WEB_VITAL_NAME)?.toLowerCase();
  const value = attributeNumber(source, WEB_VITAL_VALUE);
  const vital = CORE_WEB_VITALS.find((candidate) => candidate === name);
  return vital && value != null ? { name: vital, value } : null;
};

const classify = (source: OtelSource): SessionTimelineEventKind => {
  const name = eventNameOf(source);
  if (name === EVENT_WEB_VITAL) {
    return 'web_vital';
  }
  if (name === EVENT_EXCEPTION || attributeString(source, EVENT_OUTCOME) === 'failure') {
    return 'error';
  }
  if (name === EVENT_CLICK || name === EVENT_USER_ACTION_CLICK) {
    return 'click';
  }
  if (name === EVENT_DOCUMENT_LOAD || name === EVENT_NAVIGATION) {
    return 'page_view';
  }
  return typeof source.duration === 'number' ? 'span' : 'log';
};

const detailOf = (kind: SessionTimelineEventKind, source: OtelSource): string | null => {
  switch (kind) {
    case 'error':
      return attributeString(source, EXCEPTION_MESSAGE) ?? attributeString(source, 'error.type');
    case 'click':
      return (
        attributeString(source, 'browser.css_selector') ?? attributeString(source, 'target_xpath')
      );
    case 'web_vital':
      return attributeString(source, WEB_VITAL_VALUE);
    default:
      return attributeString(source, URL_FULL) ?? attributeString(source, 'http.url');
  }
};

const displayNameOf = (kind: SessionTimelineEventKind, source: OtelSource): string => {
  if (kind === 'web_vital') {
    return attributeString(source, WEB_VITAL_NAME)?.toUpperCase() ?? 'Web vital';
  }
  if (kind === 'error') {
    return attributeString(source, EXCEPTION_TYPE) ?? 'Error';
  }
  return eventNameOf(source) || kind;
};

const toTimelineEvent = (
  source: OtelSource,
  sessionStartMs: number
): SessionTimelineEvent | null => {
  const timestamp = source['@timestamp'];
  const ms = timestamp ? Date.parse(timestamp) : NaN;
  if (!timestamp || !Number.isFinite(ms)) {
    return null;
  }
  const kind = classify(source);
  return {
    kind,
    name: displayNameOf(kind, source),
    timestamp,
    offsetMs: Math.max(0, ms - sessionStartMs),
    // OTel span durations are stored in nanoseconds.
    durationMs: typeof source.duration === 'number' ? source.duration / 1e6 : null,
    page: pageOf(source),
    detail: detailOf(kind, source),
    traceId: source.trace_id ?? null,
    spanId: source.span_id ?? null,
  };
};

export const buildTimeline = (
  sources: OtelSource[],
  sessionStartMs: number
): SessionTimelineEvent[] =>
  sources.flatMap((source) => toTimelineEvent(source, sessionStartMs) ?? []);

/** Splits the session into consecutive page visits, attributing events to the page they ran on. */
export const buildPageVisits = (
  sources: OtelSource[],
  sessionStartMs: number,
  sessionEnd: string
): SessionPageVisit[] => {
  const visits: SessionPageVisit[] = [];
  let current: SessionPageVisit | undefined;

  let lastEventTime: string | undefined;

  const close = (endTime: string) => {
    if (current) {
      current.endTime = endTime;
      current.durationMs = Math.max(0, Date.parse(endTime) - Date.parse(current.startTime)) || 0;
      visits.push(current);
    }
  };

  for (const source of sources) {
    const event = toTimelineEvent(source, sessionStartMs);
    if (!event) {
      continue;
    }
    lastEventTime = event.timestamp;
    const { page } = event;
    if (page && page !== current?.page && (event.kind === 'page_view' || !current)) {
      close(event.timestamp);
      current = {
        page,
        url: event.kind === 'page_view' ? event.detail : null,
        startTime: event.timestamp,
        endTime: event.timestamp,
        durationMs: 0,
        clickCount: 0,
        errorCount: 0,
        webVitals: emptyWebVitals(),
      };
    }
    if (!current) {
      continue;
    }
    if (event.kind === 'click') {
      current.clickCount += 1;
    }
    if (event.kind === 'error') {
      current.errorCount += 1;
    }
    const vital = webVitalOf(source);
    if (vital) {
      // EDOT Browser reports a final value per page; keep the latest one.
      current.webVitals[vital.name] = vital.value;
    }
  }
  // Raw events can be newer than the summary, which is as fresh as the last checkpoint.
  const sessionEndMs = Date.parse(sessionEnd);
  const endsAfterSummary =
    lastEventTime !== undefined &&
    (!Number.isFinite(sessionEndMs) || Date.parse(lastEventTime) > sessionEndMs);
  close(endsAfterSummary && lastEventTime ? lastEventTime : sessionEnd);
  return visits;
};

/** The summary's start time, or the first event's when the summary has none. */
const sessionStartOf = (startMs: number, sources: OtelSource[]): number => {
  if (Number.isFinite(startMs)) {
    return startMs;
  }
  const first = sources[0]?.['@timestamp'];
  return first ? Date.parse(first) || 0 : 0;
};

/** Loads a session summary and its raw events as the given (current) user. */
export const getSession = async (
  client: ElasticsearchClient,
  { serviceName, sessionId }: { serviceName: string; sessionId: string }
): Promise<SessionDetailResponse | null> => {
  // A missing sessions index has no session, as the DSL search with `ignore_unavailable` had.
  const summaryResponse = await runEsqlRead({
    esClient: client,
    query: esql.from([SESSIONS_INDEX_PATTERN], ['_source']).pipe`WHERE service.name == ${{
      serviceName,
    }} AND session.id == ${{ sessionId }}`.pipe`SORT end_time DESC NULLS LAST`
      .pipe`KEEP _source`.limit(1),
  });
  const doc = esqlRows(summaryResponse)[0]?._source as SessionDocument | undefined;
  if (!doc) {
    return null;
  }
  const session: SessionSummary = toSessionSummary(doc);
  const startMs = Date.parse(session.startTime);

  // The raw events are OTel documents whose session id and service name are attributes, so those
  // terms (and the date range) stay in the Query DSL filter. One more row than the timeline size
  // shows whether the timeline is truncated. `_source` is the whole document, which the DSL search
  // narrowed to the timestamp, names, duration, ids and attributes; the extra fields are ignored.
  const eventsResponse = await runEsqlRead({
    esClient: client,
    query: esql.from([...SESSIONS_SOURCE_INDICES], ['_source']).pipe`SORT @timestamp ASC NULLS LAST`
      .pipe`KEEP _source`.limit(SESSION_TIMELINE_SIZE + 1),
    filter: {
      bool: {
        filter: [
          { term: { [SOURCE_SESSION_ID_FIELD]: sessionId } },
          { term: { [SOURCE_SERVICE_NAME_FIELD]: serviceName } },
          // No upper bound: events after the last checkpoint keep the timeline current at any
          // transform frequency. Session ids are random UUIDs, so this can't reach another session.
          ...(Number.isFinite(startMs)
            ? [
                {
                  range: {
                    '@timestamp': { gte: new Date(startMs - TIMELINE_SLACK_MS).toISOString() },
                  },
                },
              ]
            : []),
        ],
      },
    },
  });

  const allSources = esqlRows(eventsResponse).flatMap(({ _source }) =>
    _source !== null && typeof _source === 'object' ? [_source as OtelSource] : []
  );
  const sources = allSources.slice(0, SESSION_TIMELINE_SIZE);
  const total = allSources.length;

  return {
    session,
    timeline: buildTimeline(sources, sessionStartOf(startMs, sources)),
    timelineTruncated: total > sources.length,
    pageVisits: buildPageVisits(sources, sessionStartOf(startMs, sources), session.endTime),
  };
};
