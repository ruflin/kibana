/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ESQLSearchResponse } from '@kbn/es-types';
import type { Detection } from '@kbn/significant-events-schema';
import { DetectionClient } from './detection_client';

type StoredDetection = Partial<Omit<Detection, 'processed'>> & {
  '@timestamp': string;
  detection_id: string;
};

// A detection signal as it comes back from the `_source` read of `.rule-events`.
const createDetection = ({
  '@timestamp': timestamp,
  rule_uuid: ruleUuid = 'rule-1',
  ...data
}: StoredDetection): Record<string, unknown> => ({
  '@timestamp': timestamp,
  rule: { id: ruleUuid },
  type: 'signal',
  source: 'elastic.significant_events.detection',
  data: { rule_name: 'Rule 1', change_point_type: 'spike', ...data },
});

const sourceResponse = (docs: Array<Record<string, unknown>>): ESQLSearchResponse =>
  ({
    columns: [{ name: '_source', type: 'object' }],
    values: docs.map((d) => [d]),
  } as unknown as ESQLSearchResponse);

const countResponse = (total: number): ESQLSearchResponse =>
  ({
    columns: [{ name: 'total', type: 'long' }],
    values: [[total]],
  } as unknown as ESQLSearchResponse);

// One row per detection_id that has a processed marker.
const markerResponse = (ids: string[]): ESQLSearchResponse =>
  ({
    columns: [{ name: 'detection_id', type: 'keyword' }],
    values: ids.map((id) => [id]),
  } as unknown as ESQLSearchResponse);

const isMarkerQuery = (query: string) => query.includes('detection_processed');

interface MockResponses {
  // Detections returned by the latest/find data query (already collapsed by groupBy).
  detections: Array<Record<string, unknown>>;
  // detection_ids the processed-marker membership reports as processed.
  processedIds: string[];
}

const createClient = (responses: MockResponses) => {
  const query = jest.fn(async (request: { query: string }) => {
    const q = request.query;
    if (q.includes('STATS total')) {
      return countResponse(responses.detections.length);
    }
    if (isMarkerQuery(q)) {
      return markerResponse(responses.processedIds);
    }
    return sourceResponse(responses.detections);
  });
  const createSignalEvents = jest.fn().mockResolvedValue({ count: 0 });

  const client = new DetectionClient({
    getAlertEventsClient: jest.fn().mockResolvedValue({ createSignalEvents }),
    esClient: { esql: { query } } as never,
    space: 'default',
  });

  return { client, query, createSignalEvents };
};

const queriesFrom = (query: jest.Mock): string[] =>
  query.mock.calls.map((c) => (c[0] as { query: string }).query);

const dataQueryFrom = (query: jest.Mock): string | undefined =>
  queriesFrom(query).find((q) => !q.includes('STATS total') && !isMarkerQuery(q));

describe('DetectionClient', () => {
  describe('findLatest', () => {
    it('reads only detection signals of the space from .rule-events', async () => {
      const { client, query } = createClient({
        detections: [
          createDetection({ '@timestamp': '2026-01-02T00:00:00.000Z', detection_id: 'f-1' }),
        ],
        processedIds: [],
      });

      await client.findLatest();

      const dataQuery = dataQueryFrom(query);
      expect(dataQuery).toContain('FROM .rule-events');
      expect(dataQuery).toContain(
        'space_id == "default" AND type == "signal" AND source == "elastic.significant_events.detection"'
      );
    });

    it('groups by the rule (rule.id), not detection_id', async () => {
      const { client, query } = createClient({
        detections: [
          createDetection({ '@timestamp': '2026-01-02T00:00:00.000Z', detection_id: 'f-1' }),
        ],
        processedIds: [],
      });

      await client.findLatest();

      const dataQuery = dataQueryFrom(query);
      expect(dataQuery).toContain('EVAL rule_uuid = rule.id');
      expect(dataQuery).toContain('BY rule_uuid');
      expect(dataQuery).not.toContain('BY detection_id');
    });

    it('filters by rule and by the rule name stored in data', async () => {
      const { client, query } = createClient({ detections: [], processedIds: [] });

      await client.findLatest({ rule_uuid: ['rule-1', 'rule-2'], rule_name: 'Rule 1' });

      const dataQuery = dataQueryFrom(query);
      expect(dataQuery).toContain('rule.id IN ("rule-1", "rule-2")');
      expect(dataQuery).toContain('FIELD_EXTRACT(data, "rule_name") == "Rule 1"');
    });

    it('flattens the signal back into a detection with rule_uuid from rule.id', async () => {
      const { client } = createClient({
        detections: [
          createDetection({
            '@timestamp': '2026-01-02T00:00:00.000Z',
            detection_id: 'f-1',
            rule_uuid: 'rule-7',
            source_id: 'source-1',
            p_value: 0.0001,
          }),
        ],
        processedIds: [],
      });

      const { hits } = await client.findLatest();

      expect(hits).toEqual([
        {
          '@timestamp': '2026-01-02T00:00:00.000Z',
          detection_id: 'f-1',
          rule_uuid: 'rule-7',
          rule_name: 'Rule 1',
          source_id: 'source-1',
          change_point_type: 'spike',
          p_value: 0.0001,
          processed: false,
        },
      ]);
    });

    it('derives processed=true only for detections whose id has a marker', async () => {
      const { client, query } = createClient({
        detections: [
          createDetection({
            '@timestamp': '2026-01-02T00:00:00.000Z',
            detection_id: 'f-1',
            rule_uuid: 'rule-1',
          }),
          createDetection({
            '@timestamp': '2026-01-02T00:00:00.000Z',
            detection_id: 'f-2',
            rule_uuid: 'rule-2',
          }),
        ],
        processedIds: ['f-1'],
      });

      const result = await client.findLatest();

      const byId = new Map(result.hits.map((h) => [h.detection_id, h.processed]));
      expect(byId.get('f-1')).toBe(true);
      expect(byId.get('f-2')).toBe(false);

      const markerQuery = queriesFrom(query).find(isMarkerQuery);
      expect(markerQuery).toContain('source == "elastic.significant_events.detection_processed"');
      expect(markerQuery).toContain('FIELD_EXTRACT(data, "detection_id") IN ("f-1", "f-2")');
    });

    it('returns a rule whose latest detection is a stationary (settlement) detection', async () => {
      const { client } = createClient({
        detections: [
          createDetection({
            '@timestamp': '2026-01-03T00:00:00.000Z',
            detection_id: 'rule-1-exec-9',
            rule_uuid: 'rule-1',
            change_point_type: 'stationary',
          }),
        ],
        processedIds: [],
      });

      const result = await client.findLatest();

      expect(result.hits).toHaveLength(1);
      expect(result.hits[0].change_point_type).toBe('stationary');
      expect(result.hits[0].processed).toBe(false);
    });
  });

  describe('findLatestPaginated', () => {
    it('returns the requested page and the total of rules', async () => {
      const { client } = createClient({
        detections: [
          createDetection({ '@timestamp': '2026-01-03T00:00:00.000Z', detection_id: 'f-3' }),
          createDetection({ '@timestamp': '2026-01-02T00:00:00.000Z', detection_id: 'f-2' }),
          createDetection({ '@timestamp': '2026-01-01T00:00:00.000Z', detection_id: 'f-1' }),
        ],
        processedIds: [],
      });

      const result = await client.findLatestPaginated({ page: 2, perPage: 2 });

      expect(result).toMatchObject({ page: 2, perPage: 2, total: 3 });
      expect(result.hits.map((h) => h.detection_id)).toEqual(['f-1']);
    });
  });

  describe('findHistoryByRuleUuid', () => {
    it('reads the most recent detections of the rule and returns them oldest first', async () => {
      const { client, query } = createClient({
        detections: [
          createDetection({ '@timestamp': '2026-01-02T00:00:00.000Z', detection_id: 'f-2' }),
          createDetection({ '@timestamp': '2026-01-01T00:00:00.000Z', detection_id: 'f-1' }),
        ],
        processedIds: [],
      });

      const { hits } = await client.findHistoryByRuleUuid('rule-1');

      expect(hits.map((h) => h.detection_id)).toEqual(['f-1', 'f-2']);
      const dataQuery = dataQueryFrom(query);
      expect(dataQuery).toContain('rule.id IN ("rule-1")');
      expect(dataQuery).toContain('SORT @timestamp DESC');
      expect(dataQuery).toContain('LIMIT 20');
    });
  });

  describe('findById', () => {
    it('looks the detection up by the id stored in data', async () => {
      const { client, query } = createClient({
        detections: [
          createDetection({ '@timestamp': '2026-01-02T00:00:00.000Z', detection_id: 'f-1' }),
        ],
        processedIds: [],
      });

      await client.findById('f-1');

      const dataQuery = dataQueryFrom(query);
      expect(dataQuery).toContain('FIELD_EXTRACT(data, "detection_id") IN ("f-1")');
      expect(dataQuery).toContain('source == "elastic.significant_events.detection"');
    });

    it('derives processed from marker membership', async () => {
      const { client } = createClient({
        detections: [
          createDetection({ '@timestamp': '2026-01-02T00:00:00.000Z', detection_id: 'f-1' }),
        ],
        processedIds: ['f-1'],
      });

      const result = await client.findById('f-1');

      expect(result.hits).toHaveLength(1);
      expect(result.hits[0].processed).toBe(true);
    });
  });

  describe('findByIds', () => {
    it('does not query for an empty id list', async () => {
      const { client, query } = createClient({ detections: [], processedIds: [] });

      await expect(client.findByIds([])).resolves.toEqual({ hits: [] });
      expect(query).not.toHaveBeenCalled();
    });
  });
});

describe('DetectionClient writes', () => {
  const timestamp = '2026-01-01T00:00:00.000Z';

  it('appends detections to the series of their rule with the payload under data', async () => {
    const { client, createSignalEvents } = createClient({ detections: [], processedIds: [] });

    await client.createDetections({
      detections: [
        {
          detection_id: 'rule-1-exec-1',
          rule_uuid: 'rule-1',
          rule_name: 'Rule 1',
          source_id: 'source-1',
          change_point_type: 'spike',
          p_value: 0.001,
          severity_score: 70,
          alert_index: '.rule-events',
          workflow_execution_id: 'exec-1',
        },
      ],
      timestamp,
    });

    expect(createSignalEvents).toHaveBeenCalledWith([
      {
        source: 'elastic.significant_events.detection',
        rule_id: 'rule-1',
        timestamp,
        data: {
          detection_id: 'rule-1-exec-1',
          rule_name: 'Rule 1',
          source_id: 'source-1',
          change_point_type: 'spike',
          p_value: 0.001,
          severity_score: 70,
          alert_index: '.rule-events',
          workflow_execution_id: 'exec-1',
        },
      },
    ]);
  });

  it('drops absent optional fields from the payload', async () => {
    const { client, createSignalEvents } = createClient({ detections: [], processedIds: [] });

    await client.createDetections({
      detections: [
        { detection_id: 'd-1', rule_uuid: 'rule-1', change_point_type: 'dip', p_value: 0.01 },
      ],
      timestamp,
    });

    expect(createSignalEvents.mock.calls[0][0][0].data).toEqual({
      detection_id: 'd-1',
      change_point_type: 'dip',
      p_value: 0.01,
    });
  });

  it('writes processed markers keyed on the detection, without a rule', async () => {
    const { client, createSignalEvents } = createClient({ detections: [], processedIds: [] });

    await client.markProcessed({ detectionIds: ['d-1'], processedBy: 'exec-1', timestamp });

    expect(createSignalEvents).toHaveBeenCalledWith([
      {
        source: 'elastic.significant_events.detection_processed',
        fingerprint: 'd-1',
        timestamp,
        data: { detection_id: 'd-1', processed_by: 'exec-1' },
      },
    ]);
  });

  it('writes scan markers on the series of the scanned rule', async () => {
    const { client, createSignalEvents } = createClient({ detections: [], processedIds: [] });

    await client.markScanned({ ruleUuids: ['rule-1'], scannedBy: 'exec-1', timestamp });

    expect(createSignalEvents).toHaveBeenCalledWith([
      {
        source: 'elastic.significant_events.detection_scanned',
        rule_id: 'rule-1',
        timestamp,
        data: { scanned_by: 'exec-1' },
      },
    ]);
  });

  it('skips the write when there is nothing to write', async () => {
    const { client, createSignalEvents } = createClient({ detections: [], processedIds: [] });

    await client.markProcessed({ detectionIds: [], processedBy: 'exec-1', timestamp });

    expect(createSignalEvents).not.toHaveBeenCalled();
  });

  it('propagates a rejected write', async () => {
    const { client, createSignalEvents } = createClient({ detections: [], processedIds: [] });
    createSignalEvents.mockRejectedValue(new Error('Failed to persist 1 of 1 signal event(s)'));

    await expect(
      client.markScanned({ ruleUuids: ['rule-1'], scannedBy: 'exec-1', timestamp })
    ).rejects.toThrow('Failed to persist 1 of 1 signal event(s)');
  });
});

describe('DetectionClient.markSourceDetectionsProcessed', () => {
  const createSweepClient = ({
    detections,
    history = detections,
    processedIds = [],
    historyPageSize,
  }: {
    /** Rows the history read answers per query. Unbounded by default. */
    historyPageSize?: number;
    detections: Array<Record<string, unknown>>;
    /** Every detection of the rules, what the history read answers. Defaults to the latest ones. */
    history?: Array<Record<string, unknown>>;
    processedIds?: string[];
  }) => {
    const query = jest.fn(async (request: { query: string }) => {
      if (request.query.includes('STATS total')) {
        return countResponse(detections.length);
      }
      if (isMarkerQuery(request.query)) {
        return markerResponse(processedIds);
      }
      if (request.query.includes('rule.id IN')) {
        const lowerBound = /TO_DATETIME\("([^"]+)"\)/.exec(request.query)?.[1];
        const page = lowerBound
          ? history.filter(({ '@timestamp': ts }) => String(ts) >= lowerBound)
          : history;
        return sourceResponse(page.slice(0, historyPageSize ?? page.length));
      }
      return sourceResponse(detections);
    });
    const createSignalEvents = jest.fn().mockResolvedValue({ count: 0 });
    const client = new DetectionClient({
      getAlertEventsClient: jest.fn().mockResolvedValue({ createSignalEvents }),
      esClient: { esql: { query } } as never,
      space: 'default',
    });
    const markedIds = () =>
      createSignalEvents.mock.calls.flatMap(([events]) =>
        (events as Array<{ data: { detection_id: string; processed_by: string } }>).map(
          ({ data }) => data
        )
      );
    return { client, createSignalEvents, markedIds };
  };

  it('marks only the unprocessed detections of the deleted source', async () => {
    const { client, createSignalEvents, markedIds } = createSweepClient({
      detections: [
        createDetection({
          '@timestamp': '2026-01-01T00:00:00.000Z',
          detection_id: 'd-gone',
          source_id: 'gone',
        }),
        createDetection({
          '@timestamp': '2026-01-01T00:00:00.000Z',
          detection_id: 'd-live',
          source_id: 'live',
        }),
        createDetection({
          '@timestamp': '2026-01-01T00:00:00.000Z',
          detection_id: 'd-done',
          source_id: 'gone',
        }),
      ],
      processedIds: ['d-done'],
    });

    await expect(
      client.markSourceDetectionsProcessed({ sourceId: 'gone', processedBy: 'source-deleted' })
    ).resolves.toBe(1);

    expect(createSignalEvents).toHaveBeenCalledTimes(1);
    expect(markedIds()).toEqual([{ detection_id: 'd-gone', processed_by: 'source-deleted' }]);
  });

  it('writes nothing when the source has no unprocessed detections', async () => {
    const { client, createSignalEvents } = createSweepClient({
      detections: [
        createDetection({
          '@timestamp': '2026-01-01T00:00:00.000Z',
          detection_id: 'd-live',
          source_id: 'live',
        }),
      ],
    });

    await expect(
      client.markSourceDetectionsProcessed({ sourceId: 'gone', processedBy: 'source-deleted' })
    ).resolves.toBe(0);

    expect(createSignalEvents).not.toHaveBeenCalled();
  });

  it('marks the older unprocessed detections of a rule, not only its latest', async () => {
    const latest = createDetection({
      '@timestamp': '2026-01-02T00:00:00.000Z',
      detection_id: 'd-new',
      rule_uuid: 'rule-1',
      source_id: 'gone',
    });
    const older = createDetection({
      '@timestamp': '2026-01-01T00:00:00.000Z',
      detection_id: 'd-old',
      rule_uuid: 'rule-1',
      source_id: 'gone',
    });
    const { client, markedIds } = createSweepClient({
      detections: [latest],
      history: [older, latest],
      processedIds: ['d-done'],
    });

    await expect(
      client.markSourceDetectionsProcessed({ sourceId: 'gone', processedBy: 'source-deleted' })
    ).resolves.toBe(2);

    expect(markedIds()).toEqual([
      { detection_id: 'd-old', processed_by: 'source-deleted' },
      { detection_id: 'd-new', processed_by: 'source-deleted' },
    ]);
  });

  it('pages through a rule history longer than one read', async () => {
    const make = (id: string, day: number) =>
      createDetection({
        '@timestamp': `2026-01-0${day}T00:00:00.000Z`,
        detection_id: id,
        rule_uuid: 'rule-1',
        source_id: 'gone',
      });
    const all = [make('d-1', 1), make('d-2', 2), make('d-3', 3), make('d-4', 4), make('d-5', 5)];
    const { client, markedIds } = createSweepClient({
      detections: [all[4]],
      history: all,
      // The first two are processed, the rest are the newer rows a single capped read would drop.
      processedIds: ['d-1', 'd-2'],
      historyPageSize: 2,
    });

    await expect(
      client.markSourceDetectionsProcessed({
        sourceId: 'gone',
        processedBy: 'source-deleted',
        historyPageSize: 2,
      })
    ).resolves.toBe(3);

    expect(markedIds()).toEqual(
      ['d-3', 'd-4', 'd-5'].map((id) => ({ detection_id: id, processed_by: 'source-deleted' }))
    );
  });
});
