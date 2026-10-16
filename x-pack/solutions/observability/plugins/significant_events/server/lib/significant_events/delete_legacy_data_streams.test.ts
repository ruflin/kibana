/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import {
  deleteLegacyDataStreams,
  LEGACY_DETECTIONS_DATA_STREAM,
  LEGACY_EVENTS_DATA_STREAM,
} from './delete_legacy_data_streams';

describe('deleteLegacyDataStreams', () => {
  it('deletes the retired events and detections data streams and templates', async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    const logger = loggingSystemMock.createLogger();

    await deleteLegacyDataStreams({ esClient, logger });

    for (const name of [LEGACY_EVENTS_DATA_STREAM, LEGACY_DETECTIONS_DATA_STREAM]) {
      expect(esClient.indices.deleteDataStream).toHaveBeenCalledWith({ name });
      expect(esClient.indices.deleteIndexTemplate).toHaveBeenCalledWith({ name });
    }
  });

  it('ignores missing resources and continues startup cleanup', async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    const logger = loggingSystemMock.createLogger();
    const notFound = Object.assign(new Error('not found'), { meta: { statusCode: 404 } });
    esClient.indices.deleteDataStream.mockRejectedValue(notFound);
    esClient.indices.deleteIndexTemplate.mockRejectedValue(notFound);

    await expect(deleteLegacyDataStreams({ esClient, logger })).resolves.toBeUndefined();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps deleting the remaining streams when one deletion fails', async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    const logger = loggingSystemMock.createLogger();
    esClient.indices.deleteDataStream.mockRejectedValueOnce(new Error('boom'));

    await deleteLegacyDataStreams({ esClient, logger });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(esClient.indices.deleteDataStream).toHaveBeenCalledWith({
      name: LEGACY_DETECTIONS_DATA_STREAM,
    });
  });
});
