/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { SOURCE_SERVICE_NAME_FIELD, SOURCE_SESSION_ID_FIELD } from './source_fields';
import {
  SESSION_TIMELINE_SIZE,
  buildPageVisits,
  buildTimeline,
  getSession,
  type OtelSource,
} from './get_session';

const START = '2026-10-20T10:00:00.000Z';
const startMs = Date.parse(START);
const at = (offsetMs: number) => new Date(startMs + offsetMs).toISOString();

const events: OtelSource[] = [
  {
    '@timestamp': at(0),
    name: 'documentLoad',
    duration: 850_000_000,
    trace_id: 't1',
    span_id: 's1',
    attributes: { 'url.full': 'https://shop.example.com/?ref=ad' },
  },
  {
    '@timestamp': at(1_000),
    event_name: 'browser.web_vital',
    attributes: { browser: { web_vital: { name: 'lcp', value: 1200 } } },
  },
  {
    '@timestamp': at(2_000),
    event_name: 'browser.user_action.click',
    attributes: { 'browser.css_selector': 'button.add', 'url.full': 'https://shop.example.com/' },
  },
  {
    '@timestamp': at(5_000),
    event_name: 'browser.navigation',
    attributes: { 'url.full': 'https://shop.example.com/#/cart' },
  },
  {
    '@timestamp': at(6_000),
    event_name: 'exception',
    attributes: {
      'exception.type': 'TypeError',
      'exception.message': 'x is undefined',
      'url.full': 'https://shop.example.com/#/cart',
    },
  },
  { name: 'missing timestamp' },
];

describe('buildTimeline', () => {
  it('classifies events and computes offsets from the session start', () => {
    const timeline = buildTimeline(events, startMs);

    expect(
      timeline.map(({ kind, name, offsetMs, page }) => ({ kind, name, offsetMs, page }))
    ).toEqual([
      { kind: 'page_view', name: 'documentLoad', offsetMs: 0, page: '/' },
      { kind: 'web_vital', name: 'LCP', offsetMs: 1_000, page: null },
      { kind: 'click', name: 'browser.user_action.click', offsetMs: 2_000, page: '/' },
      { kind: 'page_view', name: 'browser.navigation', offsetMs: 5_000, page: '/cart' },
      { kind: 'error', name: 'TypeError', offsetMs: 6_000, page: '/cart' },
    ]);
    expect(timeline[0]).toEqual(
      expect.objectContaining({ durationMs: 850, traceId: 't1', spanId: 's1' })
    );
    expect(timeline[2].detail).toBe('button.add');
    expect(timeline[4].detail).toBe('x is undefined');
  });
});

describe('buildPageVisits', () => {
  it('builds the per-page journey with counts and web vitals', () => {
    const visits = buildPageVisits(events, startMs, at(10_000));

    expect(visits).toEqual([
      {
        page: '/',
        url: 'https://shop.example.com/?ref=ad',
        startTime: at(0),
        endTime: at(5_000),
        durationMs: 5_000,
        clickCount: 1,
        errorCount: 0,
        webVitals: { lcp: 1200, inp: null, cls: null, fcp: null, ttfb: null },
      },
      {
        page: '/cart',
        url: 'https://shop.example.com/#/cart',
        startTime: at(5_000),
        endTime: at(10_000),
        durationMs: 5_000,
        clickCount: 0,
        errorCount: 1,
        webVitals: { lcp: null, inp: null, cls: null, fcp: null, ttfb: null },
      },
    ]);
  });
});

describe('getSession', () => {
  const sessionColumns = [{ name: '_source', type: '_source' }];

  it('returns null when the session is not in the sessions index', async () => {
    const client = elasticsearchServiceMock.createElasticsearchClient();
    client.esql.query.mockResolvedValueOnce({ columns: sessionColumns, values: [] } as any);

    expect(await getSession(client, { serviceName: 'web', sessionId: 'abc' })).toBeNull();
    expect(client.esql.query).toHaveBeenCalledTimes(1);
  });

  it('loads the summary and the raw events for the session', async () => {
    const client = elasticsearchServiceMock.createElasticsearchClient();
    client.esql.query
      .mockResolvedValueOnce(summaryResponse({ start_time: START, end_time: at(10_000) }) as any)
      .mockResolvedValueOnce(eventsResponse(events.slice(0, 5)) as any);

    const detail = await getSession(client, { serviceName: 'web', sessionId: 'abc' });

    expect(detail?.session.sessionId).toBe('abc');
    expect(detail?.timeline).toHaveLength(5);
    expect(detail?.timelineTruncated).toBe(false);
    expect(detail?.pageVisits.map(({ page }) => page)).toEqual(['/', '/cart']);
    expect(client.esql.query.mock.calls[0][0]).toEqual({
      query:
        'FROM digital-experience-sessions-* METADATA _source | WHERE service.name == ?serviceName AND session.id == ?sessionId | SORT end_time DESC NULLS LAST | KEEP _source | LIMIT 1',
      params: [{ serviceName: 'web' }, { sessionId: 'abc' }],
    });
    expect(client.esql.query.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        query: expect.stringContaining(
          'SORT @timestamp ASC NULLS LAST | KEEP _source | LIMIT 1001'
        ),
        filter: {
          bool: {
            filter: [
              { term: { [SOURCE_SESSION_ID_FIELD]: 'abc' } },
              { term: { [SOURCE_SERVICE_NAME_FIELD]: 'web' } },
              // No upper bound, so events after the last checkpoint still show.
              { range: { '@timestamp': { gte: at(-60_000) } } },
            ],
          },
        },
      })
    );
  });

  it('flags a truncated timeline when more events than the timeline size match', async () => {
    const client = elasticsearchServiceMock.createElasticsearchClient();
    const many = Array.from({ length: SESSION_TIMELINE_SIZE + 1 }, (_, i) => ({
      '@timestamp': at(i),
      event_name: 'browser.user_action.click',
    }));
    client.esql.query
      .mockResolvedValueOnce(summaryResponse({ start_time: START, end_time: at(10_000) }) as any)
      .mockResolvedValueOnce(eventsResponse(many) as any);

    const detail = await getSession(client, { serviceName: 'web', sessionId: 'abc' });

    expect(detail?.timeline).toHaveLength(SESSION_TIMELINE_SIZE);
    expect(detail?.timelineTruncated).toBe(true);
  });

  it('keeps the last page visit open until the newest raw event', async () => {
    const client = elasticsearchServiceMock.createElasticsearchClient();
    client.esql.query
      .mockResolvedValueOnce(summaryResponse({ start_time: START, end_time: at(3_000) }) as any)
      .mockResolvedValueOnce(eventsResponse(events.slice(0, 5)) as any);

    const detail = await getSession(client, { serviceName: 'web', sessionId: 'abc' });

    // The summary ends at 3s, but the transform has not seen the events at 5s and 6s yet.
    expect(detail?.pageVisits.at(-1)).toEqual(
      expect.objectContaining({ page: '/cart', endTime: at(6_000), durationMs: 1_000 })
    );
  });

  it('does not throw when the summary has no start or end time', async () => {
    const client = elasticsearchServiceMock.createElasticsearchClient();
    client.esql.query
      .mockResolvedValueOnce(summaryResponse({}) as any)
      .mockResolvedValueOnce(eventsResponse(events.slice(0, 5)) as any);

    const detail = await getSession(client, { serviceName: 'web', sessionId: 'abc' });

    expect(detail?.timeline.map(({ offsetMs }) => offsetMs)).toEqual([
      0, 1_000, 2_000, 5_000, 6_000,
    ]);
    expect(detail?.pageVisits.at(-1)?.endTime).toBe(at(6_000));
    const eventsFilter = (client.esql.query.mock.calls[1][0] as { filter?: unknown }).filter;
    expect(JSON.stringify(eventsFilter)).not.toContain('range');
  });
});

const summaryResponse = (times: { start_time?: string; end_time?: string }) => ({
  columns: [{ name: '_source', type: '_source' }],
  values: [[{ session: { id: 'abc' }, service: { name: 'web' }, ...times }]],
});

const eventsResponse = (sources: OtelSource[]) => ({
  columns: [{ name: '_source', type: '_source' }],
  values: sources.map((source) => [source]),
});
