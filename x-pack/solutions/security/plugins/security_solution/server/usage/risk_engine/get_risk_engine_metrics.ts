/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger, ElasticsearchClient } from '@kbn/core/server';
import { esql } from '@elastic/esql';
import type { RiskEngineMetrics } from './types';
import { esqlRows, runEsqlRead } from '../../utils/esql/esql_read';

interface GetRiskEngineMetricsOptions {
  esClient: ElasticsearchClient;
  logger: Logger;
  riskEngineIndexPatterns: {
    all: string;
    latest: string;
  };
}

const toNumber = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;

const getEntitiesAggregationData = async ({
  esClient,
  index,
  logger,
  hostMetricField,
  userMetricField,
  serviceMetricField,
  lastDay,
}: {
  esClient: ElasticsearchClient;
  index: string;
  logger: Logger;
  hostMetricField: string;
  userMetricField: string;
  serviceMetricField: string;
  lastDay: boolean;
}) => {
  try {
    // `value_count` counted the values of each field, which is what `COUNT(field)` does.
    const sourceQuery = esql.from([index]);
    const query = (lastDay
      ? sourceQuery.pipe`WHERE @timestamp >= NOW() - 24 hours AND @timestamp < NOW()`
      : sourceQuery
    ).pipe`STATS user_name = COUNT(user.name), host_name = COUNT(host.name)`;
    const response = await runEsqlRead({ esClient, query, tolerateUnknownIndex: false });
    const [row] = esqlRows(response);

    return {
      [userMetricField]: toNumber(row?.user_name),
      [hostMetricField]: toNumber(row?.host_name),
      [serviceMetricField]: undefined,
    };
  } catch (err) {
    logger.error(
      `Error while fetching risk score metrics for ${hostMetricField}, ${userMetricField} and ${serviceMetricField} : ${err}`
    );
    return {};
  }
};

const getIndexSize = async ({
  esClient,
  index,
  logger,
  metricField,
}: {
  esClient: ElasticsearchClient;
  index: string;
  logger: Logger;
  metricField: string;
}) => {
  try {
    const riskScoreIndexStats = await esClient.indices.stats({
      index,
    });
    const sizeInMb = (riskScoreIndexStats?._all?.primaries?.store?.size_in_bytes ?? 0) / 1e6;
    return {
      [metricField]: sizeInMb,
    };
  } catch (err) {
    logger.error(`Error while fetching risk score  metrics for ${metricField}: ${err}`);
    return {};
  }
};

export const getRiskEngineMetrics = async ({
  esClient,
  logger,
  riskEngineIndexPatterns,
}: GetRiskEngineMetricsOptions): Promise<RiskEngineMetrics> => {
  logger.info('Fetch risk engine metrics');

  try {
    const riskEngineIndexes = await esClient.indices.get({
      index: `${riskEngineIndexPatterns.all}`,
    });

    const isRiskEngineExists = Object.keys(riskEngineIndexes).length > 0;

    if (!isRiskEngineExists) {
      return {};
    }

    const results = await Promise.all([
      getEntitiesAggregationData({
        esClient,
        index: riskEngineIndexPatterns.latest,
        logger,
        lastDay: false,
        hostMetricField: 'unique_host_risk_score_total',
        userMetricField: 'unique_user_risk_score_total',
        serviceMetricField: 'unique_service_risk_score_total',
      }),
      getEntitiesAggregationData({
        esClient,
        index: riskEngineIndexPatterns.latest,
        logger,
        lastDay: true,
        hostMetricField: 'unique_host_risk_score_day',
        userMetricField: 'unique_user_risk_score_day',
        serviceMetricField: 'unique_service_risk_score_day',
      }),
      getEntitiesAggregationData({
        esClient,
        index: riskEngineIndexPatterns.all,
        logger,
        lastDay: false,
        hostMetricField: 'all_host_risk_scores_total',
        userMetricField: 'all_user_risk_scores_total',
        serviceMetricField: 'all_service_risk_scores_total',
      }),
      getEntitiesAggregationData({
        esClient,
        index: riskEngineIndexPatterns.all,
        logger,
        lastDay: true,
        hostMetricField: 'all_host_risk_scores_total_day',
        userMetricField: 'all_user_risk_scores_total_day',
        serviceMetricField: 'all_service_risk_scores_total_day',
      }),
      getIndexSize({
        esClient,
        logger,
        index: riskEngineIndexPatterns.all,
        metricField: 'all_risk_scores_index_size',
      }),
      getIndexSize({
        esClient,
        logger,
        index: riskEngineIndexPatterns.latest,
        metricField: 'unique_risk_scores_index_size',
      }),
    ]);

    return results.reduce((acc, curr) => ({ ...acc, ...curr }), {});
  } catch (e) {
    logger.error(`Error while fetching risk engine metrics: ${e.message}`);
    return {};
  }
};
