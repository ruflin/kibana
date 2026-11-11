/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EsqlEsqlResult } from '@elastic/elasticsearch/lib/api/types';
import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { DIFFABLE_CHANGE_ACTIONS } from '../../../public/detection_engine/rule_details_ui/components/changes_history_timeline/constants';
import { getChangesHistoryUsage, REVISION_SAVED_ACTIONS } from './get_changes_history_usage';

const getMockChangesHistoryResponse = ({
  revisionSavedDocCount,
  ruleRestoredDocCount,
}: {
  revisionSavedDocCount: number;
  ruleRestoredDocCount: number;
}): EsqlEsqlResult => ({
  columns: [
    { name: 'revision_saved', type: 'long' },
    { name: 'rule_restored', type: 'long' },
  ],
  values: [[revisionSavedDocCount, ruleRestoredDocCount]],
});

describe('get_changes_history_usage', () => {
  let esClient: ReturnType<typeof elasticsearchServiceMock.createElasticsearchClient>;

  beforeEach(() => {
    esClient = elasticsearchServiceMock.createClusterClient().asInternalUser;
  });

  test('revision_saved counts diffable-action docs in the window', async () => {
    const logger = loggingSystemMock.createLogger();
    esClient.esql.query.mockResponseOnce(
      getMockChangesHistoryResponse({ revisionSavedDocCount: 3, ruleRestoredDocCount: 0 })
    );

    const result = await getChangesHistoryUsage({ esClient, logger });

    expect(result.revision_saved).toEqual(3);
  });

  test('revision_saved is zero when no matching docs exist in the window', async () => {
    const logger = loggingSystemMock.createLogger();
    esClient.esql.query.mockResponseOnce(
      getMockChangesHistoryResponse({ revisionSavedDocCount: 0, ruleRestoredDocCount: 0 })
    );

    const result = await getChangesHistoryUsage({ esClient, logger });

    expect(result.revision_saved).toEqual(0);
  });

  test('rule_restored counts only rule_restore docs, independent of revision_saved', async () => {
    const logger = loggingSystemMock.createLogger();
    esClient.esql.query.mockResponseOnce(
      getMockChangesHistoryResponse({ revisionSavedDocCount: 0, ruleRestoredDocCount: 1 })
    );

    const result = await getChangesHistoryUsage({ esClient, logger });

    expect(result).toEqual({ revision_saved: 0, rule_restored: 1 });
  });

  test('rule_restored is zero when revision_saved has docs but no restore docs exist', async () => {
    const logger = loggingSystemMock.createLogger();
    esClient.esql.query.mockResponseOnce(
      getMockChangesHistoryResponse({ revisionSavedDocCount: 5, ruleRestoredDocCount: 0 })
    );

    const result = await getChangesHistoryUsage({ esClient, logger });

    expect(result).toEqual({ revision_saved: 5, rule_restored: 0 });
  });

  test('degrades to both-zero on ES error and does not throw', async () => {
    const logger = loggingSystemMock.createLogger();
    esClient.esql.query.mockRejectedValue(new Error('index_not_found_exception'));

    const result = await getChangesHistoryUsage({ esClient, logger });

    expect(result).toEqual({ revision_saved: 0, rule_restored: 0 });
    expect(logger.debug).toHaveBeenCalled();
  });

  test('counts both actions in one ES|QL query over the last 24 hours', async () => {
    const logger = loggingSystemMock.createLogger();
    esClient.esql.query.mockResponseOnce(
      getMockChangesHistoryResponse({ revisionSavedDocCount: 1, ruleRestoredDocCount: 1 })
    );

    await getChangesHistoryUsage({ esClient, logger });

    const [request] = esClient.esql.query.mock.calls[0] as unknown as [
      { query: string; params: Array<Record<string, string>> }
    ];
    expect(request.query).toContain('FROM .kibana_change_history');
    expect(request.query).toContain('@timestamp >= NOW() - 24 hours');
    expect(request.query).toContain('revision_saved = COUNT(*) WHERE (event.action IN (?revision0');
    expect(request.params).toEqual(
      expect.arrayContaining([
        { revision0: REVISION_SAVED_ACTIONS[0] },
        { restored: 'rule_restore' },
      ])
    );
  });

  test('REVISION_SAVED_ACTIONS stays in sync with the UI DIFFABLE_CHANGE_ACTIONS taxonomy', () => {
    expect([...REVISION_SAVED_ACTIONS].sort()).toEqual([...DIFFABLE_CHANGE_ACTIONS].sort());
  });
});
