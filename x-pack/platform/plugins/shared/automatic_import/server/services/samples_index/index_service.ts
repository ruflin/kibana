/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient, Logger, LoggerFactory } from '@kbn/core/server';
import type {
  AutomaticImportSamplesProperties,
  AutomaticImportSamplesIndexAdapter,
} from './storage';
import { automaticImportSamplesIndexName, createIndexAdapter } from './storage';
import type { OriginalSource } from '../../../common';
import { UPLOAD_SAMPLES_MAX_LINES } from '../../../common';

export interface AddSamplesToDataStreamParams {
  integrationId: string;
  dataStreamId: string;
  rawSamples: string[];
  originalSource: OriginalSource;
  createdBy: string;
}

export class AutomaticImportSamplesIndexService {
  private logger: Logger;
  private internalEsClient: ElasticsearchClient | null = null;

  constructor(logger: LoggerFactory) {
    this.logger = logger.get('samplesIndexService');
  }

  /**
   * Initializes the service with the internal ES client. Must be called during plugin start.
   */
  public initialize(esClient: ElasticsearchClient): void {
    this.internalEsClient = esClient;
  }

  private getAdapter(): AutomaticImportSamplesIndexAdapter {
    if (!this.internalEsClient) {
      throw new Error(
        'AutomaticImportSamplesIndexService not initialized: internal ES client not set'
      );
    }
    return createIndexAdapter({
      logger: this.logger,
      esClient: this.internalEsClient,
    });
  }

  /**
   * Creates samples documents in the samples index.
   */
  public async addSamplesToDataStream(params: AddSamplesToDataStreamParams) {
    const { integrationId, dataStreamId, rawSamples, originalSource, createdBy } = params;

    const samplesIndexAdapter = this.getAdapter();

    const operations = rawSamples.map((sample: string) => {
      const document: Omit<AutomaticImportSamplesProperties, '_id'> = {
        integration_id: integrationId,
        data_stream_id: dataStreamId,
        log_data: sample,
        created_by: createdBy,
        original_source: {
          source_type: originalSource.sourceType,
          source_value: originalSource.sourceValue,
        },
        metadata: {
          created_at: new Date().toISOString(),
        },
      };
      return {
        index: {
          document,
        },
      };
    });

    return samplesIndexAdapter.getClient().bulk({ operations });
  }

  /**
   * Gets samples for a data stream
   * @param integrationId - The integration ID
   * @param dataStreamId - The data stream ID
   * @returns The samples for the data stream
   */
  public async getSamplesForDataStream(integrationId: string, dataStreamId: string) {
    const samplesIndexAdapter = this.getAdapter();

    // `log_data` is an unindexed text field, so it is read from `_source`. The limit is the number
    // of lines an upload accepts.
    const results = await samplesIndexAdapter.getClient().esql({
      metadata: ['_source'],
      pipeline: esql`WHERE integration_id == ${{ integrationId }} AND data_stream_id == ${{
        dataStreamId,
      }} | KEEP _source | LIMIT ${{ limit: UPLOAD_SAMPLES_MAX_LINES }}`,
    });
    const sourceColumn = results.columns.findIndex((column) => column.name === '_source');
    const samples: string[] = results.values.map(
      (row) => (row[sourceColumn] as AutomaticImportSamplesProperties).log_data
    );
    return samples;
  }

  /**
   * Deletes all samples for a data stream
   * @param integrationId - The integration ID
   * @param dataStreamId - The data stream ID
   * @returns The number of deleted samples
   */
  public async deleteSamplesForDataStream(integrationId: string, dataStreamId: string) {
    if (!this.internalEsClient) {
      throw new Error(
        'AutomaticImportSamplesIndexService not initialized: internal ES client not set'
      );
    }

    const result = await this.internalEsClient.deleteByQuery({
      index: automaticImportSamplesIndexName,
      query: {
        bool: {
          must: [
            { term: { integration_id: integrationId } },
            { term: { data_stream_id: dataStreamId } },
          ],
        },
      },
      refresh: true,
      ignore_unavailable: true,
      conflicts: 'proceed',
    });

    const deletedCount = typeof result.deleted === 'number' ? result.deleted : 0;

    this.logger.debug(
      `Deleted ${deletedCount} samples for data stream ${dataStreamId} in integration ${integrationId}`
    );

    return { deleted: deletedCount };
  }
}
