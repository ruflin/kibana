/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';

export const SIG_EVENTS_RESULTS_DATA_STREAM = '.streams.sig_events_results-default';
const SIG_EVENTS_RESULTS_INDEX_TEMPLATE = '.streams.sig_events_results';
const SIG_EVENTS_RESULTS_COMPONENT_TEMPLATE = '.streams.sig_events_results-mappings';

export interface SigEventsResult {
  '@timestamp': string;
  query_id: string;
  stream_name: string;
  query_type: 'row' | 'stats';
  result: Record<string, unknown>;
  event_count: number;
}

export class SigEventsResultsClient {
  constructor(
    private readonly esClient: ElasticsearchClient,
    private readonly logger: Logger
  ) {}

  async ensureDataStream(): Promise<void> {
    try {
      await this.esClient.cluster.getComponentTemplate({
        name: SIG_EVENTS_RESULTS_COMPONENT_TEMPLATE,
      });
    } catch {
      await this.esClient.cluster.putComponentTemplate({
        name: SIG_EVENTS_RESULTS_COMPONENT_TEMPLATE,
        template: {
          mappings: {
            properties: {
              '@timestamp': { type: 'date' },
              query_id: { type: 'keyword' },
              stream_name: { type: 'keyword' },
              query_type: { type: 'keyword' },
              result: { type: 'object', enabled: false },
              event_count: { type: 'long' },
            },
          },
        },
      });
    }

    try {
      await this.esClient.indices.getIndexTemplate({
        name: SIG_EVENTS_RESULTS_INDEX_TEMPLATE,
      });
    } catch {
      await this.esClient.indices.putIndexTemplate({
        name: SIG_EVENTS_RESULTS_INDEX_TEMPLATE,
        index_patterns: ['.streams.sig_events_results-*'],
        data_stream: {},
        composed_of: [SIG_EVENTS_RESULTS_COMPONENT_TEMPLATE],
        priority: 500,
      });
    }

    try {
      await this.esClient.indices.getDataStream({
        name: SIG_EVENTS_RESULTS_DATA_STREAM,
      });
    } catch {
      await this.esClient.indices.createDataStream({
        name: SIG_EVENTS_RESULTS_DATA_STREAM,
      });
    }
  }

  async writeResult(result: SigEventsResult): Promise<void> {
    try {
      await this.esClient.index({
        index: SIG_EVENTS_RESULTS_DATA_STREAM,
        document: result,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write sig events result: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async writeResults(results: SigEventsResult[]): Promise<void> {
    if (results.length === 0) return;

    try {
      const body = results.flatMap((doc) => [
        { index: { _index: SIG_EVENTS_RESULTS_DATA_STREAM } },
        doc,
      ]);
      await this.esClient.bulk({ body, refresh: false });
    } catch (error) {
      this.logger.warn(
        `Failed to bulk write sig events results: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async searchResults(params: {
    queryId?: string;
    streamName?: string;
    queryType?: 'row' | 'stats';
    from?: string;
    to?: string;
    size?: number;
  }): Promise<SigEventsResult[]> {
    const filters: Array<Record<string, unknown>> = [];

    if (params.queryId) {
      filters.push({ term: { query_id: params.queryId } });
    }
    if (params.streamName) {
      filters.push({ term: { stream_name: params.streamName } });
    }
    if (params.queryType) {
      filters.push({ term: { query_type: params.queryType } });
    }
    if (params.from || params.to) {
      const range: Record<string, string> = {};
      if (params.from) range.gte = params.from;
      if (params.to) range.lte = params.to;
      filters.push({ range: { '@timestamp': range } });
    }

    try {
      const response = await this.esClient.search({
        index: SIG_EVENTS_RESULTS_DATA_STREAM,
        size: params.size ?? 100,
        query: filters.length > 0 ? { bool: { filter: filters } } : { match_all: {} },
        sort: [{ '@timestamp': { order: 'desc' } }],
      });

      return response.hits.hits.map((hit) => hit._source as SigEventsResult);
    } catch (error) {
      this.logger.debug(
        `Failed to search sig events results: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }
}
