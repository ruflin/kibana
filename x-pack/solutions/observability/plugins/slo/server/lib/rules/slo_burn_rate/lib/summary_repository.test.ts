/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClientMock } from '@kbn/core/server/mocks';
import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { createSLO } from '../../../../services/fixtures/slo';
import { getSloSummary } from './summary_repository';

describe('getSloSummary', () => {
  let esClient: ElasticsearchClientMock;

  beforeEach(() => {
    esClient = elasticsearchServiceMock.createElasticsearchClient();
    esClient.esql.query.mockResolvedValue({
      columns: [{ name: '_source', type: 'unsupported' }],
      values: [],
    });
  });

  it('includes project_routing in the search when projectRouting is provided', async () => {
    const slo = createSLO({ id: 'irrelevant' });

    await getSloSummary(esClient, slo, '*', '_alias:_origin');

    expect(esClient.esql.query.mock.calls[0][0]).toEqual(
      expect.objectContaining({ project_routing: '_alias:_origin' })
    );
  });

  it('omits project_routing from the search when projectRouting is not provided', async () => {
    const slo = createSLO({ id: 'irrelevant' });

    await getSloSummary(esClient, slo, '*');

    expect(esClient.esql.query.mock.calls[0][0]).not.toHaveProperty('project_routing');
  });

  it('looks up the summary by slo id, revision and instance id and returns its source', async () => {
    const slo = createSLO({ id: 'my-slo', revision: 3 });
    esClient.esql.query.mockResolvedValue({
      columns: [{ name: '_source', type: 'unsupported' }],
      values: [[{ slo: { id: 'my-slo' }, status: 'VIOLATED' }]],
    } as never);

    const summary = await getSloSummary(esClient, slo, 'instance-1');

    expect(esClient.esql.query.mock.calls[0][0]).toEqual({
      query:
        'FROM .slo-observability.summary-v3* METADATA _source | WHERE slo.id == ?sloId AND slo.revision == ?sloRevision AND slo.instanceId == ?instanceId | LIMIT 1',
      params: [{ sloId: 'my-slo' }, { sloRevision: 3 }, { instanceId: 'instance-1' }],
    });
    expect(summary).toEqual({ slo: { id: 'my-slo' }, status: 'VIOLATED' });
  });
});
