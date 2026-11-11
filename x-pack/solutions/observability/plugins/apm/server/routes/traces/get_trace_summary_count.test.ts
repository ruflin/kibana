/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { APMEventClient } from '@kbn/apm-data-access-plugin/server';
import { esqlResponse, toEsqlRequest } from '../../utils/esql_test_helpers';
import { getTraceSummaryCount } from './get_trace_summary_count';

describe('getTraceSummaryCount', () => {
  it('counts the span and transaction documents and the distinct services of the trace', async () => {
    const esql = jest.fn().mockResolvedValue(esqlResponse(['trace_events', 'services'], [[12, 3]]));

    const result = await getTraceSummaryCount({
      apmEventClient: { esql } as unknown as APMEventClient,
      start: 1_700_000_000_000,
      end: 1_700_000_900_000,
      traceId: 'trace-1',
    });

    expect(result).toEqual({ services: 3, traceEvents: 12 });
    // OTel-native documents have no processor.event, so the event filter is part of the query
    expect(esql.mock.calls[0][1].skipProcessorEventFilter).toBe(true);
    expect(toEsqlRequest(esql.mock.calls[0][1])).toMatchInlineSnapshot(`
      Object {
        "apm": Object {
          "events": Array [
            "span",
            "transaction",
          ],
        },
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000000000,
                    "lte": 1700000900000,
                  },
                },
              },
            ],
          },
        },
        "params": Array [
          Object {
            "trace_id_value": "trace-1",
          },
          Object {
            "processorEvents": Array [
              "span",
              "transaction",
            ],
          },
        ],
        "query": "SET unmapped_fields = \\"nullify\\"; FROM myIndex | WHERE \`trace.id\` == ?trace_id_value | WHERE (\`processor.event\` IN (?processorEvents)) OR \`processor.event\` IS NULL | STATS trace_events = COUNT(*), services = COUNT_DISTINCT(\`service.name\`) | LIMIT 1",
      }
    `);
  });

  it('returns zero counts when no index matches', async () => {
    const esql = jest.fn().mockResolvedValue(undefined);

    const result = await getTraceSummaryCount({
      apmEventClient: { esql } as unknown as APMEventClient,
      start: 0,
      end: 1,
      traceId: 'trace-1',
    });

    expect(result).toEqual({ services: 0, traceEvents: 0 });
  });
});
