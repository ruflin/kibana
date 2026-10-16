/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { DataStreamsStart } from '@kbn/core-data-streams-server';
import type { SpaceId } from '@kbn/core-spaces-common';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { SIGNIFICANT_EVENTS_DETECTION_SIGNAL_SOURCES } from '@kbn/significant-events-schema';
import type { SignificantEventsMaintenanceFailure } from '../../../common/maintenance/types';
import { KNOWLEDGE_INDICATORS_DATA_STREAM } from '../knowledge_indicators/data_stream';
import { RULE_EVENTS_INDEX } from '../significant_events/alerting/rule_events_metric_series';
import { DISCOVERIES_DATA_STREAM } from '../significant_events/discoveries_data_stream';
import { toMessage } from './to_message';

export const RESET_REGISTERED_DATA_STREAMS = [KNOWLEDGE_INDICATORS_DATA_STREAM] as const;

/**
 * Streams reset reads and clears without owning them: Kibana neither initializes nor creates them.
 * Detections live as signals in the shared Alerting v2 `.rule-events` stream.
 */
const RESET_UNREGISTERED_DATA_STREAMS = [DISCOVERIES_DATA_STREAM, RULE_EVENTS_INDEX] as const;

/**
 * The current space's documents reset deletes from a stream. In `.rule-events` that is only the
 * detection pipeline's signals; Significant Events history and every other producer are kept.
 */
const getResetQuery = (name: string, spaceId: SpaceId): QueryDslQueryContainer =>
  name === RULE_EVENTS_INDEX
    ? {
        bool: {
          filter: [
            { term: { space_id: spaceId } },
            { term: { type: 'signal' } },
            { terms: { source: [...SIGNIFICANT_EVENTS_DETECTION_SIGNAL_SOURCES] } },
          ],
        },
      }
    : { term: { 'kibana.space_ids': spaceId } };

interface ResetDataStreamsParams {
  /** The caller authorizes refresh and document deletion, not the Kibana system user. */
  esClient: ElasticsearchClient;
  /** Kibana owns stream initialization and missing-stream recovery. */
  internalEsClient: ElasticsearchClient;
  dataStreams: DataStreamsStart;
  failures: SignificantEventsMaintenanceFailure[];
}

/** Initialize missing registered streams and refresh before snapshot reads or document deletion. */
export const prepareDataStreamsForReset = async ({
  esClient,
  internalEsClient,
  dataStreams,
  failures,
}: ResetDataStreamsParams): Promise<Set<string>> => {
  const prepared = new Set<string>();
  for (const name of [...RESET_REGISTERED_DATA_STREAMS, ...RESET_UNREGISTERED_DATA_STREAMS]) {
    const registered = (RESET_REGISTERED_DATA_STREAMS as readonly string[]).includes(name);
    if (registered) {
      try {
        await dataStreams.initializeClient(name);
      } catch (error) {
        failures.push({ target: `data-stream:${name}:initialize`, error: toMessage(error) });
        continue;
      }
    }

    try {
      const exists = await internalEsClient.indices.exists({ index: name });
      if (!exists) {
        if (!registered) {
          continue;
        }
        await internalEsClient.indices.createDataStream({ name });
      }
    } catch (error) {
      failures.push({ target: `data-stream:${name}`, error: toMessage(error) });
      continue;
    }

    try {
      await esClient.indices.refresh({ index: name });
      prepared.add(name);
    } catch (error) {
      // An unrefreshed revision must not be mistaken for an empty or fully cleared stream.
      failures.push({ target: `data-stream:${name}:refresh`, error: toMessage(error) });
    }
  }
  return prepared;
};

/**
 * Delete only the current space's documents, leaving untagged history and other producers' documents
 * in shared streams intact.
 */
export const resetDataStreams = async ({
  esClient,
  spaceId,
  preparedStreams,
  failures,
}: Pick<ResetDataStreamsParams, 'esClient' | 'failures'> & {
  spaceId: SpaceId;
  preparedStreams: ReadonlySet<string>;
}): Promise<{ affected: Set<string>; completed: Set<string> }> => {
  const affected = new Set<string>();
  const completed = new Set<string>();
  const streamNames = [...preparedStreams];
  const results = await Promise.allSettled(
    streamNames.map(async (name) =>
      esClient.deleteByQuery({
        index: name,
        query: getResetQuery(name, spaceId),
        conflicts: 'proceed',
        refresh: true,
        ignore_unavailable: true,
        wait_for_completion: true,
      })
    )
  );
  // Aggregate in stream order, independently of request completion order.
  for (const [index, result] of results.entries()) {
    const name = streamNames[index];
    if (result.status === 'rejected') {
      failures.push({ target: `data-stream:${name}:delete`, error: toMessage(result.reason) });
      continue;
    }

    const response = result.value;
    if ((response.deleted ?? 0) > 0) {
      affected.add(name);
    }
    const errors = (response.failures ?? []).map((failure) => JSON.stringify(failure));
    if (response.timed_out) {
      errors.push('Document deletion timed out');
    }
    if (response.version_conflicts) {
      errors.push(`${response.version_conflicts} document deletion version conflict(s)`);
    }
    if (errors.length > 0) {
      failures.push({ target: `data-stream:${name}:delete`, error: errors.join('; ') });
    } else {
      completed.add(name);
    }
  }
  return { affected, completed };
};
