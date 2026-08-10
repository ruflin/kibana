/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { SignificantEventsStatsInterval } from '../../../common/stats';
import { CHAT_CONVERSATIONS_INDEX, SIGNIFICANT_EVENTS_AGENT_ID_PREFIX } from './constants';

export interface MappedConversationStats {
  available: boolean;
  total: number;
  daily: Array<{
    date: string;
    total: number;
    byAgent: Record<string, number>;
  }>;
}

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

export const queryConversationStats = async ({
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
}): Promise<MappedConversationStats> => {
  try {
    const response = await esClient.search({
      index: CHAT_CONVERSATIONS_INDEX,
      allow_no_indices: true,
      ignore_unavailable: true,
      size: 0,
      track_total_hits: false,
      query: {
        bool: {
          filter: [
            { term: { space: spaceId } },
            { prefix: { agent_id: SIGNIFICANT_EVENTS_AGENT_ID_PREFIX } },
            { range: { created_at: { gte: from, lt: to } } },
          ],
        },
      },
      aggs: {
        by_day: {
          date_histogram: {
            field: 'created_at',
            calendar_interval: calendarInterval(interval),
            min_doc_count: 0,
            extended_bounds: { min: from, max: to },
          },
          aggs: {
            by_agent: {
              terms: { field: 'agent_id', size: 20 },
            },
          },
        },
      },
    });

    const dayBuckets =
      (
        response.aggregations as
          | {
              by_day?: {
                buckets?: Array<{
                  key_as_string?: string;
                  key: number;
                  doc_count: number;
                  by_agent?: { buckets?: Array<{ key: string | number; doc_count: number }> };
                }>;
              };
            }
          | undefined
      )?.by_day?.buckets ?? [];

    let total = 0;
    const daily = dayBuckets.map((day) => {
      total += day.doc_count;
      const byAgent: Record<string, number> = {};
      for (const agent of day.by_agent?.buckets ?? []) {
        byAgent[String(agent.key)] = agent.doc_count;
      }
      return {
        date: day.key_as_string ?? new Date(day.key).toISOString(),
        total: day.doc_count,
        byAgent,
      };
    });

    return { available: true, total, daily };
  } catch (error) {
    if (isIndexMissingError(error)) {
      return { available: false, total: 0, daily: [] };
    }
    throw error;
  }
};
