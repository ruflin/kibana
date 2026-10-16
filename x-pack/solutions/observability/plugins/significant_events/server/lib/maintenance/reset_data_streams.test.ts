/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SIGNIFICANT_EVENTS_DETECTION_SIGNAL_SOURCES } from '@kbn/significant-events-schema';
import type { SignificantEventsMaintenanceFailure } from '../../../common/maintenance/types';
import { KNOWLEDGE_INDICATORS_DATA_STREAM } from '../knowledge_indicators/data_stream';
import { RULE_EVENTS_INDEX } from '../significant_events/alerting/rule_events_metric_series';
import { DISCOVERIES_DATA_STREAM } from '../significant_events/discoveries_data_stream';
import {
  REQUEST,
  makeService,
  makeManagementApi,
  spaceOfResetQuery,
} from './maintenance_service.test_helpers';
import { prepareDataStreamsForReset, resetDataStreams } from './reset_data_streams';

describe('space-scoped data stream reset', () => {
  it('removes all matching revisions and markers, preserving another space and untagged legacy data', async () => {
    const fixture = makeService({ management: makeManagementApi().api });
    const documents = [
      { id: 'shared-id', space: 'default', kind: 'feature' },
      { id: 'shared-id', space: 'default', kind: 'expired-feature' },
      { id: 'shared-id', space: 'default', kind: 'excluded-feature' },
      { id: 'shared-id', space: 'default', kind: 'tombstone' },
      { id: 'query', space: 'default', kind: 'query' },
      { id: 'detection', space: 'default', kind: 'processed-marker' },
      { id: 'shared-id', space: 'other', kind: 'feature' },
      { id: 'legacy', space: undefined, kind: 'feature' },
    ];
    fixture.esClient.deleteByQuery.mockImplementation(async ({ query }) => {
      const before = documents.length;
      for (let i = documents.length - 1; i >= 0; i--) {
        if (documents[i].space === spaceOfResetQuery(query)) documents.splice(i, 1);
      }
      return {
        deleted: before - documents.length,
        failures: [],
        timed_out: false,
        version_conflicts: 0,
      };
    });

    await fixture.service.reset({ request: REQUEST });

    expect(documents).toEqual([
      { id: 'shared-id', space: 'other', kind: 'feature' },
      { id: 'legacy', space: undefined, kind: 'feature' },
    ]);
    expect(fixture.esClient.indices.deleteDataStream).not.toHaveBeenCalled();
    expect(fixture.internalEsClient.indices.createDataStream).not.toHaveBeenCalled();
  });

  it.each([
    { failures: [{ cause: { reason: 'write blocked' } }], version_conflicts: 0, timed_out: false },
    { failures: [], version_conflicts: 2, timed_out: false },
    { failures: [], version_conflicts: 0, timed_out: true },
  ])('reports incomplete deletion without confirming logical KI counts: %o', async (result) => {
    const { service, esClient } = makeService({
      management: makeManagementApi().api,
      knowledgeIndicatorCounts: { feature: 10, query: 5 },
    });
    esClient.deleteByQuery.mockImplementation(async ({ index }) => ({
      deleted: index === KNOWLEDGE_INDICATORS_DATA_STREAM ? 2 : 0,
      ...(index === KNOWLEDGE_INDICATORS_DATA_STREAM
        ? result
        : { failures: [], timed_out: false, version_conflicts: 0 }),
    }));

    const summary = await service.reset({ request: REQUEST });

    expect(summary.deleted).toMatchObject({
      knowledgeIndicators: 0,
      storedQueries: 0,
      dataStreams: 1,
    });
    expect(summary.partialFailures).toEqual([
      {
        target: `data-stream:${KNOWLEDGE_INDICATORS_DATA_STREAM}:delete`,
        error: expect.any(String),
      },
    ]);
  });

  it('continues other streams after caller deletion fails, without using an internal delete client', async () => {
    const { service, esClient, internalEsClient } = makeService({
      management: makeManagementApi().api,
    });
    esClient.deleteByQuery.mockRejectedValueOnce(new Error('delete denied'));

    const summary = await service.reset({ request: REQUEST });

    expect(summary.partialFailures).toContainEqual({
      target: `data-stream:${KNOWLEDGE_INDICATORS_DATA_STREAM}:delete`,
      error: 'delete denied',
    });
    expect(esClient.deleteByQuery).toHaveBeenCalledWith(
      expect.objectContaining({ index: RULE_EVENTS_INDEX })
    );
    expect(internalEsClient.deleteByQuery).not.toHaveBeenCalled();
  });

  it('does not create a missing discoveries stream or select an unprepared stream', async () => {
    const { esClient, internalEsClient, initializeClient } = makeService();
    const failures: SignificantEventsMaintenanceFailure[] = [];
    const prepared = await prepareDataStreamsForReset({
      esClient: esClient as never,
      internalEsClient: internalEsClient as never,
      dataStreams: { initializeClient } as never,
      failures,
    });
    expect(prepared.has(DISCOVERIES_DATA_STREAM)).toBe(false);
    await resetDataStreams({
      esClient: esClient as never,
      spaceId: REQUEST.spaceId,
      preparedStreams: new Set(),
      failures,
    });
    expect(esClient.deleteByQuery).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
  });

  it('deletes only the space detection signals from .rule-events, never creating it', async () => {
    const { esClient, internalEsClient, initializeClient } = makeService();
    const failures: SignificantEventsMaintenanceFailure[] = [];
    const prepared = await prepareDataStreamsForReset({
      esClient: esClient as never,
      internalEsClient: internalEsClient as never,
      dataStreams: { initializeClient } as never,
      failures,
    });
    expect(prepared.has(RULE_EVENTS_INDEX)).toBe(true);
    expect(initializeClient).not.toHaveBeenCalledWith(RULE_EVENTS_INDEX);

    await resetDataStreams({
      esClient: esClient as never,
      spaceId: REQUEST.spaceId,
      preparedStreams: new Set([RULE_EVENTS_INDEX]),
      failures,
    });

    expect(esClient.deleteByQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        index: RULE_EVENTS_INDEX,
        query: {
          bool: {
            filter: [
              { term: { space_id: REQUEST.spaceId } },
              { term: { type: 'signal' } },
              { terms: { source: [...SIGNIFICANT_EVENTS_DETECTION_SIGNAL_SOURCES] } },
            ],
          },
        },
      })
    );
    expect(failures).toEqual([]);
  });

  it('skips a missing .rule-events without creating it', async () => {
    const { esClient, internalEsClient, initializeClient } = makeService({ dataStreams: {} });
    const failures: SignificantEventsMaintenanceFailure[] = [];

    const prepared = await prepareDataStreamsForReset({
      esClient: esClient as never,
      internalEsClient: internalEsClient as never,
      dataStreams: { initializeClient } as never,
      failures,
    });

    expect(prepared.has(RULE_EVENTS_INDEX)).toBe(false);
    expect(internalEsClient.indices.createDataStream).not.toHaveBeenCalledWith({
      name: RULE_EVENTS_INDEX,
    });
  });
});
