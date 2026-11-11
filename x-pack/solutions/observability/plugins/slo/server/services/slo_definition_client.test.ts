/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClientMock } from '@kbn/core/server/mocks';
import {
  elasticsearchServiceMock,
  httpServiceMock,
  loggingSystemMock,
} from '@kbn/core/server/mocks';
import type { MockedLogger } from '@kbn/logging-mocks';
import { createSLO } from './fixtures/slo';
import { createSLORepositoryMock } from './mocks';
import { IllegalArgumentError } from '../errors';
import { SLODefinitionClient } from './slo_definition_client';
import type { SLODefinitionRepository } from './slo_definition_repository';
import { createTempSummaryDocument } from './summary_transform_generator/helpers/create_temp_summary';

describe('SLODefinitionClient', () => {
  let esClientMock: ElasticsearchClientMock;
  let loggerMock: jest.Mocked<MockedLogger>;
  let mockRepository: jest.Mocked<SLODefinitionRepository>;
  let sloDefinitionClient: SLODefinitionClient;

  jest.useFakeTimers().setSystemTime(new Date('2024-01-01'));

  beforeEach(() => {
    esClientMock = elasticsearchServiceMock.createElasticsearchClient();
    loggerMock = loggingSystemMock.createLogger();
    mockRepository = createSLORepositoryMock();

    sloDefinitionClient = new SLODefinitionClient(mockRepository, esClientMock, loggerMock);
  });

  describe('happy path', () => {
    it('fetches the SLO Definition from the SLO repository when no remoteName is specified', async () => {
      const slo = createSLO({ id: 'fixed-id' });
      mockRepository.findById.mockResolvedValueOnce(slo);

      const response = await sloDefinitionClient.execute('fixed-id', 'default');

      expect(response).toEqual({ slo });
    });

    it('fetches the SLO Definition from the remote summary index when a remoteName is specified', async () => {
      const slo = createSLO({ id: 'fixed-id' });
      const summaryDoc = createTempSummaryDocument(
        slo,
        'default',
        httpServiceMock.createStartContract().basePath
      );
      esClientMock.esql.query.mockResolvedValueOnce({
        columns: [{ name: '_source', type: 'unsupported' }],
        values: [[summaryDoc]],
      } as never);

      const response = await sloDefinitionClient.execute('fixed-id', 'default', 'remote_cluster');

      expect(response).toMatchSnapshot();
      expect(esClientMock.esql.query.mock.calls[0][0]).toEqual({
        query:
          'FROM remote_cluster:.slo-observability.summary-v3* METADATA _source | WHERE spaceId == ?spaceId AND slo.id == ?sloId | LIMIT 1',
        params: [{ spaceId: 'default' }, { sloId: 'fixed-id' }],
      });
    });
  });

  describe('remoteName validation', () => {
    it.each([
      'remote | DROP spaceId',
      'remote\nFROM other',
      'remote:*',
      'remote,other',
      'remote"x',
      '_remote',
      '-remote',
      'a'.repeat(300),
    ])('rejects the remoteName %j without querying', async (remoteName) => {
      await expect(sloDefinitionClient.execute('fixed-id', 'default', remoteName)).rejects.toThrow(
        IllegalArgumentError
      );
      expect(esClientMock.esql.query).not.toHaveBeenCalled();
    });
  });
});
