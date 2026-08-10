/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { isEsqlUnknownIndexError } from '@kbn/storage-adapter';
import type { SignificantEventsStatsInterval } from '../../../common/stats';
import { MEMORIES_DATA_STREAM } from '../../../common/memory_and_investigation';
import { KNOWLEDGE_INDICATORS_DATA_STREAM } from '../knowledge_indicators/data_stream';
import { DETECTIONS_DATA_STREAM } from '../significant_events/detections/data_stream';
import { EVENTS_DATA_STREAM } from '../significant_events/events/data_stream';
import { runEsqlQuery } from '../significant_events/run_esql_query';

export interface MappedArtifactStats {
  totals: {
    events: number;
    detections: number;
    knowledgeIndicators: number;
    memories: number;
  };
  daily: Array<{
    date: string;
    events: number;
    detections: number;
    knowledgeIndicators: number;
    memories: number;
  }>;
}

const bucketIntervalLiteral = (interval: SignificantEventsStatsInterval): string =>
  interval === '1h' ? '1 hour' : '1 day';

const columnIndex = (columns: ESQLSearchResponse['columns'], name: string): number =>
  columns.findIndex((column) => column.name === name);

const readString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value ?? '');
};

const readNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
};

const queryDistinctPerDay = async ({
  esClient,
  index,
  spaceId,
  from,
  to,
  interval,
  groupField,
}: {
  esClient: ElasticsearchClient;
  index: string;
  spaceId: string;
  from: string;
  to: string;
  interval: SignificantEventsStatsInterval;
  groupField: string;
}): Promise<Map<string, number>> => {
  try {
    const response = await runEsqlQuery(
      esClient,
      `FROM ${index}
| WHERE kibana.space_ids == "${spaceId}" OR kibana.space_ids IS NULL
| WHERE @timestamp >= "${from}" AND @timestamp < "${to}"
| STATS count = COUNT_DISTINCT(${groupField}) BY day = BUCKET(@timestamp, ${bucketIntervalLiteral(
        interval
      )})
| SORT day`
    );

    if (!response) {
      return new Map();
    }

    const dayCol = columnIndex(response.columns, 'day');
    const countCol = columnIndex(response.columns, 'count');
    const result = new Map<string, number>();
    for (const row of response.values ?? []) {
      result.set(readString(row[dayCol]), readNumber(row[countCol]));
    }
    return result;
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) {
      return new Map();
    }
    throw error;
  }
};

const mergeDailyMaps = (
  maps: Record<keyof MappedArtifactStats['totals'], Map<string, number>>
): MappedArtifactStats => {
  const dates = new Set<string>();
  for (const map of Object.values(maps)) {
    for (const date of map.keys()) {
      dates.add(date);
    }
  }

  const daily = Array.from(dates)
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({
      date,
      events: maps.events.get(date) ?? 0,
      detections: maps.detections.get(date) ?? 0,
      knowledgeIndicators: maps.knowledgeIndicators.get(date) ?? 0,
      memories: maps.memories.get(date) ?? 0,
    }));

  const totals = {
    events: 0,
    detections: 0,
    knowledgeIndicators: 0,
    memories: 0,
  };
  for (const day of daily) {
    totals.events += day.events;
    totals.detections += day.detections;
    totals.knowledgeIndicators += day.knowledgeIndicators;
    totals.memories += day.memories;
  }

  return { totals, daily };
};

export const queryArtifactStats = async ({
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
}): Promise<MappedArtifactStats> => {
  const [events, detections, knowledgeIndicators, memories] = await Promise.all([
    queryDistinctPerDay({
      esClient,
      index: EVENTS_DATA_STREAM,
      spaceId,
      from,
      to,
      interval,
      groupField: 'event_id',
    }),
    queryDistinctPerDay({
      esClient,
      index: DETECTIONS_DATA_STREAM,
      spaceId,
      from,
      to,
      interval,
      groupField: 'detection_id',
    }),
    queryDistinctPerDay({
      esClient,
      index: KNOWLEDGE_INDICATORS_DATA_STREAM,
      spaceId,
      from,
      to,
      interval,
      // KIs are keyed by (stream.name, type, id); id alone is unique per type in practice for counting activity.
      groupField: 'id',
    }),
    queryDistinctPerDay({
      esClient,
      index: MEMORIES_DATA_STREAM,
      spaceId,
      from,
      to,
      interval,
      groupField: 'id',
    }),
  ]);

  return mergeDailyMaps({ events, detections, knowledgeIndicators, memories });
};
