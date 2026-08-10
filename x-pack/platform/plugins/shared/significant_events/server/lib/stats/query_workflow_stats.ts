/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import { GLOBAL_WORKFLOW_SPACE_ID } from '@kbn/workflows/server';
import type { SignificantEventsStatsInterval } from '../../../common/stats';
import { SIGNIFICANT_EVENTS_MANAGED_BY, WORKFLOWS_EXECUTIONS_INDEX } from './constants';
import {
  mapWorkflowAggs,
  type MappedWorkflowStats,
  type WorkflowAggResponse,
} from './map_workflow_aggs';

const isIndexMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybeError = error as {
    statusCode?: number;
    meta?: { body?: { error?: { type?: string } } };
    message?: string;
  };
  if (maybeError.statusCode === 404) {
    return true;
  }
  if (maybeError.meta?.body?.error?.type === 'index_not_found_exception') {
    return true;
  }
  return typeof maybeError.message === 'string' && maybeError.message.includes('index_not_found');
};

const calendarInterval = (interval: SignificantEventsStatsInterval): string =>
  interval === '1h' ? 'hour' : 'day';

export const queryWorkflowStats = async ({
  esClient,
  spaceId,
  from,
  to,
  interval,
}: {
  esClient: ElasticsearchClient;
  spaceId: string;
  from: string;
  to: string;
  interval: SignificantEventsStatsInterval;
}): Promise<MappedWorkflowStats> => {
  try {
    const response = (await esClient.search({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      allow_no_indices: true,
      ignore_unavailable: true,
      size: 0,
      track_total_hits: false,
      query: {
        bool: {
          filter: [
            { term: { managedBy: SIGNIFICANT_EVENTS_MANAGED_BY } },
            {
              bool: {
                should: [{ term: { spaceId } }, { term: { spaceId: GLOBAL_WORKFLOW_SPACE_ID } }],
                minimum_should_match: 1,
              },
            },
            { range: { createdAt: { gte: from, lt: to } } },
          ],
          must_not: [{ term: { isTestRun: true } }, { exists: { field: 'stepId' } }],
        },
      },
      aggs: {
        by_day: {
          date_histogram: {
            field: 'createdAt',
            calendar_interval: calendarInterval(interval),
            min_doc_count: 0,
            extended_bounds: { min: from, max: to },
          },
          aggs: {
            by_workflow: {
              terms: { field: 'originManagedWorkflowId', size: 30 },
            },
            by_status: {
              terms: { field: 'status', size: 10 },
            },
            input_tokens: { sum: { field: 'usage.inputTokens' } },
            output_tokens: { sum: { field: 'usage.outputTokens' } },
            cached_tokens: { sum: { field: 'usage.cachedTokens' } },
          },
        },
        by_workflow: {
          terms: { field: 'originManagedWorkflowId', size: 30 },
          aggs: {
            by_status: { terms: { field: 'status', size: 10 } },
            input_tokens: { sum: { field: 'usage.inputTokens' } },
            output_tokens: { sum: { field: 'usage.outputTokens' } },
            cached_tokens: { sum: { field: 'usage.cachedTokens' } },
          },
        },
        by_status: {
          terms: { field: 'status', size: 10 },
        },
        input_tokens: { sum: { field: 'usage.inputTokens' } },
        output_tokens: { sum: { field: 'usage.outputTokens' } },
        cached_tokens: { sum: { field: 'usage.cachedTokens' } },
      },
    })) as WorkflowAggResponse;

    return mapWorkflowAggs({ response, available: true });
  } catch (error) {
    if (isIndexMissingError(error)) {
      return mapWorkflowAggs({ response: undefined, available: false });
    }
    throw error;
  }
};
