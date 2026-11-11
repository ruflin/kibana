/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';

import { getPanicLogsLastHour } from './agent_logs_panics';

describe('getPanicLogsLastHour', () => {
  it('returns no logs without an Elasticsearch client', async () => {
    expect(await getPanicLogsLastHour(undefined)).toEqual({ agent_logs_panics_last_hour: [] });
  });

  it('reads the latest panic messages of the last hour', async () => {
    const esClient = elasticsearchServiceMock.createClusterClient().asInternalUser;
    esClient.esql.query.mockResolvedValue({
      columns: [
        { name: 'message', type: 'text' },
        { name: '@timestamp', type: 'date' },
      ],
      values: [
        ['panic: boom', '2026-01-01T00:00:02.000Z'],
        [null, '2026-01-01T00:00:01.000Z'],
      ],
    } as any);

    const result = await getPanicLogsLastHour(esClient);

    expect(esClient.esql.query).toHaveBeenCalledWith({
      query:
        'FROM logs-elastic_agent-* | WHERE @timestamp >= NOW() - 1 hour AND MATCH(message, ?text) | SORT @timestamp DESC NULLS LAST | KEEP message, @timestamp | LIMIT 100',
      params: [{ text: 'panic' }],
    });
    expect(result).toEqual({
      agent_logs_panics_last_hour: [
        { message: 'panic: boom', timestamp: '2026-01-01T00:00:02.000Z' },
        { message: '', timestamp: '2026-01-01T00:00:01.000Z' },
      ],
    });
  });

  it('returns no logs when there is no agent log index yet', async () => {
    const esClient = elasticsearchServiceMock.createClusterClient().asInternalUser;
    esClient.esql.query.mockRejectedValue(
      Object.assign(new Error('Unknown index'), {
        statusCode: 400,
        body: {
          error: {
            type: 'verification_exception',
            reason: 'Unknown index [logs-elastic_agent-*]',
          },
        },
      })
    );

    expect(await getPanicLogsLastHour(esClient)).toEqual({ agent_logs_panics_last_hour: [] });
  });
});
