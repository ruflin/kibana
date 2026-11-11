/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import type {
  ActionableFinding,
  DataQualityResultDocument,
  QualityPayload,
} from '@kbn/siem-readiness';
import { isQualityIncompatible } from '@kbn/siem-readiness';
import { esql } from '@elastic/esql';
import { esqlRows, runEsqlRead } from '../../../utils/esql/esql_read';

const DATA_QUALITY_RESULTS_INDEX = '.kibana-data-quality-dashboard-results-*';

const fetchDataQualityResults = async ({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): Promise<DataQualityResultDocument[]> => {
  try {
    // Newest first, so the first document seen for an index is its latest result. The index
    // pattern matching nothing is an empty result, as `ignore_unavailable` made it.
    const response = await runEsqlRead({
      esClient,
      query: esql.from([DATA_QUALITY_RESULTS_INDEX], ['_source']).pipe`SORT checkedAt DESC`
        .keep('_source')
        .limit(10000),
    });

    const seen = new Set<string>();
    const results: DataQualityResultDocument[] = [];

    for (const { _source: source } of esqlRows(response)) {
      if (source !== null && typeof source === 'object') {
        const result = source as DataQualityResultDocument;
        if (!seen.has(result.indexName)) {
          seen.add(result.indexName);
          results.push(result);
        }
      }
    }

    return results;
  } catch (error: unknown) {
    const e = error as { message?: string };
    logger.warn(`Failed to fetch data quality results: ${e.message ?? 'unknown error'}`);
    return [];
  }
};

export const getQuality = async ({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): Promise<QualityPayload> => {
  const qualityResults = await fetchDataQualityResults({ esClient, logger });

  const actionableFindings: ActionableFinding[] = qualityResults
    .filter((result) => isQualityIncompatible(result.incompatibleFieldCount))
    .map((result) => ({
      severity: 'WARNING' as const,
      message: `${result.indexName} has ${result.incompatibleFieldCount} incompatible ECS fields`,
      resource: result.indexName,
    }));

  const status =
    qualityResults.length === 0
      ? ('noData' as const)
      : actionableFindings.length > 0
      ? ('actionsRequired' as const)
      : ('healthy' as const);

  const summary = buildQualitySummary(status, qualityResults.length, actionableFindings.length);

  return { status, summary, items: qualityResults, actionableFindings };
};

const buildQualitySummary = (
  status: string,
  checkedCount: number,
  incompatibleCount: number
): string => {
  if (status === 'noData')
    return 'No data quality check results found. Run a data quality check to see results.';
  if (incompatibleCount > 0) {
    return `${incompatibleCount} of ${checkedCount} checked indices have incompatible ECS field mappings.`;
  }
  return `All ${checkedCount} checked indices are ECS-compatible.`;
};
