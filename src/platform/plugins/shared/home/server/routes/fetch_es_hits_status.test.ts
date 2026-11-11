/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { httpServerMock, httpServiceMock } from '@kbn/core/server/mocks';
import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import { registerHitsStatusRoute } from './fetch_es_hits_status';

const unknownIndexError = () =>
  Object.assign(new Error('verification_exception'), {
    statusCode: 400,
    body: {
      error: {
        type: 'verification_exception',
        reason: 'Found 1 problem\nline 1:6: Unknown index [filebeat-*]',
      },
    },
  });

describe('POST /api/home/hits_status', () => {
  const setup = () => {
    const router = httpServiceMock.createRouter();
    registerHitsStatusRoute(router);
    const handler = router.post.mock.calls[0][1];
    const esClient = elasticsearchServiceMock.createScopedClusterClient();
    const context = { core: Promise.resolve({ elasticsearch: { client: esClient } }) };
    const response = httpServerMock.createResponseFactory();
    const run = (body: { index: string; query: Record<string, unknown> }) =>
      handler(context as never, httpServerMock.createKibanaRequest({ body }), response);
    return { esClient, run, response };
  };

  it('asks for one row of the index with the caller query as the request filter', async () => {
    const { esClient, run, response } = setup();
    esClient.asCurrentUser.esql.query.mockResolvedValue({
      columns: [],
      values: [['a']],
    } as never);

    await run({ index: 'filebeat-*,logs-*', query: { match_all: {} } });

    expect(esClient.asCurrentUser.esql.query).toHaveBeenCalledWith({
      query: 'FROM filebeat-*, logs-* | LIMIT 1',
      params: [],
      filter: { match_all: {} },
    });
    expect(response.ok).toHaveBeenCalledWith({ body: { count: 1 } });
  });

  it('quotes an index name that is not a plain index pattern', async () => {
    const { esClient, run } = setup();
    esClient.asCurrentUser.esql.query.mockResolvedValue({ columns: [], values: [] } as never);

    await run({ index: 'a" | DROP x', query: {} });

    expect(esClient.asCurrentUser.esql.query).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'FROM "a\\" | DROP x" | LIMIT 1' })
    );
  });

  it('counts no hits for a wildcard that matches no index', async () => {
    const { esClient, run, response } = setup();
    esClient.asCurrentUser.esql.query.mockRejectedValue(unknownIndexError());

    await run({ index: 'filebeat-*', query: { match_all: {} } });

    expect(response.ok).toHaveBeenCalledWith({ body: { count: 0 } });
  });

  it('keeps a missing explicit index an error', async () => {
    const { esClient, run, response } = setup();
    esClient.asCurrentUser.esql.query.mockRejectedValue(unknownIndexError());

    await run({ index: 'filebeat-1', query: { match_all: {} } });

    expect(response.badRequest).toHaveBeenCalledTimes(1);
    expect(response.ok).not.toHaveBeenCalled();
  });
});
