/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SpanLinkDetails } from '@kbn/apm-types';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlResponse, toEsqlRequest } from '../../utils/esql_test_helpers';
import { getSpanLinksDetails } from './get_span_links_details';

const columns = [
  'trace.id',
  'service.name',
  'processor.event',
  'span.id',
  'span.name',
  'span.duration.us',
  'span.subtype',
  'span.type',
  'agent.name',
  'transaction.id',
  'transaction.name',
  'transaction.duration.us',
];

describe('getSpanLinksDetails', () => {
  const spanLinks = [
    { trace: { id: 'trace-a' }, span: { id: 'span-a' } },
    { trace: { id: 'trace-b' }, span: { id: 'tx-b' } },
  ];

  it('reads the linked spans and transactions with one request, in the order of the links', async () => {
    const esql = jest.fn().mockResolvedValue(
      esqlResponse(columns, [
        // a transaction linked by its transaction id
        [
          'trace-b',
          'svc-b',
          'transaction',
          null,
          null,
          null,
          null,
          null,
          'go',
          'tx-b',
          'GET /b',
          200,
        ],
        // a span linked by its span id
        [
          'trace-a',
          'svc-a',
          'span',
          'span-a',
          'SELECT',
          100,
          'postgresql',
          'db',
          'java',
          'tx-a',
          null,
          null,
        ],
        // a sibling span of the linked transaction: same transaction id, not a link
        [
          'trace-b',
          'svc-b',
          'span',
          'sibling',
          'GET',
          10,
          'http',
          'external',
          'go',
          'tx-b',
          null,
          null,
        ],
        // the span id of another link in the trace of this one: not a link
        [
          'trace-a',
          'svc-a',
          'span',
          'tx-b',
          'SELECT',
          10,
          'postgresql',
          'db',
          'java',
          'tx-a',
          null,
          null,
        ],
      ])
    );

    const result: SpanLinkDetails[] = await getSpanLinksDetails({
      apmEventClient: { esql } as unknown as APMEventClient,
      spanLinks,
      kuery: '',
      start: 1_700_000_000_000,
      end: 1_700_000_900_000,
    });

    expect(esql).toHaveBeenCalledTimes(1);
    expect(result.map(({ traceId, spanId }) => `${traceId}:${spanId}`)).toEqual([
      'trace-a:span-a',
      'trace-b:tx-b',
    ]);
    expect(result[0].details).toMatchObject({ spanName: 'SELECT', serviceName: 'svc-a' });
    expect(result[1].details).toMatchObject({ spanName: 'GET /b', transactionId: 'tx-b' });
    expect(esql.mock.calls[0][1].skipProcessorEventFilter).toBe(true);
    const { query, params } = toEsqlRequest(esql.mock.calls[0][1]);
    expect(query).toContain('WHERE `trace.id` IN (?traceIds)');
    expect(query).toContain(
      'WHERE (`span.id` IN (?spanIds)) OR (`transaction.id` IN (?transactionIds))'
    );
    expect(query).toContain('LIMIT 1000');
    expect(params).toEqual(
      expect.arrayContaining([
        { traceIds: ['trace-a', 'trace-b'] },
        { spanIds: ['span-a', 'tx-b'] },
        { transactionIds: ['span-a', 'tx-b'] },
      ])
    );
  });

  it('keeps the links without details as external links only when there is no kuery', async () => {
    const esql = jest.fn().mockResolvedValue(esqlResponse(columns, []));
    const apmEventClient = { esql } as unknown as APMEventClient;
    const range = { start: 0, end: 1000 };

    const withoutKuery = await getSpanLinksDetails({
      apmEventClient,
      spanLinks,
      kuery: '',
      ...range,
    });
    const withKuery = await getSpanLinksDetails({
      apmEventClient,
      spanLinks,
      kuery: 'service.name: "x"',
      ...range,
    });

    expect(withoutKuery).toEqual([
      { traceId: 'trace-a', spanId: 'span-a' },
      { traceId: 'trace-b', spanId: 'tx-b' },
    ]);
    expect(withKuery).toEqual([]);
  });

  it('does not query when there are no links', async () => {
    const esql = jest.fn();

    const result = await getSpanLinksDetails({
      apmEventClient: { esql } as unknown as APMEventClient,
      spanLinks: [],
      kuery: '',
      start: 0,
      end: 1000,
    });

    expect(result).toEqual([]);
    expect(esql).not.toHaveBeenCalled();
  });
});
