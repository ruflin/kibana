/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { esql } from '@elastic/esql';
import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import type { CoreStart, Logger, SavedObjectsClientContract } from '@kbn/core/server';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { getCloudDefendStatus } from '../../../routes/status/status';
import type { CloudDefendPluginStart, CloudDefendPluginStartDeps } from '../../../types';

import type { CloudDefendIndicesStats, IndexStats } from './types';
import {
  ALERTS_INDEX_PATTERN,
  FILE_INDEX_PATTERN,
  PROCESS_INDEX_PATTERN,
} from '../../../../common/constants';

const getIndexDocCount = (esClient: ElasticsearchClient, index: string) =>
  esClient.indices.stats({ index });

const getLatestDocTimestamp = async (
  esClient: ElasticsearchClient,
  index: string
): Promise<string | null> => {
  const latestTimestamp = await esClient.esql.query(
    esql.from([index])
      .pipe`STATS latest = MAX(@timestamp)`.toRequest() as unknown as EsqlQueryRequest
  );

  const latestEventTimestamp = latestTimestamp.values[0]?.[0];

  return typeof latestEventTimestamp === 'string' ? latestEventTimestamp : null;
};

const getIndexStats = async (
  esClient: ElasticsearchClient,
  index: string,
  logger: Logger
): Promise<IndexStats | {}> => {
  try {
    const lastDocTimestamp = await getLatestDocTimestamp(esClient, index);

    if (lastDocTimestamp) {
      const indexStats = await getIndexDocCount(esClient, index);
      return {
        doc_count: indexStats._all.primaries?.docs ? indexStats._all.primaries?.docs?.count : 0,
        deleted: indexStats._all.primaries?.docs?.deleted
          ? indexStats._all.primaries?.docs?.deleted
          : 0,
        size_in_bytes: indexStats._all.primaries?.store
          ? indexStats._all.primaries?.store.size_in_bytes
          : 0,
        last_doc_timestamp: lastDocTimestamp,
      };
    }

    return {};
  } catch (e) {
    logger.error(`Failed to get index stats for ${index}`);
    return {};
  }
};

export const getIndicesStats = async (
  esClient: ElasticsearchClient,
  soClient: SavedObjectsClientContract,
  coreServices: Promise<[CoreStart, CloudDefendPluginStartDeps, CloudDefendPluginStart]>,
  logger: Logger
): Promise<CloudDefendIndicesStats> => {
  const [alerts, file, process] = await Promise.all([
    getIndexStats(esClient, ALERTS_INDEX_PATTERN, logger),
    getIndexStats(esClient, FILE_INDEX_PATTERN, logger),
    getIndexStats(esClient, PROCESS_INDEX_PATTERN, logger),
  ]);

  const [, cloudDefendPluginStartDeps] = await coreServices;

  let status = 'not_installed';
  let latestPackageVersion = 'unknown';
  let installedPackagePolicies = 0;
  let healthyAgents = 0;

  try {
    const statusResult = await getCloudDefendStatus({
      logger,
      esClient,
      soClient,
      agentPolicyService: cloudDefendPluginStartDeps.fleet.agentPolicyService,
      agentService: cloudDefendPluginStartDeps.fleet.agentService,
      packagePolicyService: cloudDefendPluginStartDeps.fleet.packagePolicyService,
      packageService: cloudDefendPluginStartDeps.fleet.packageService,
    });

    status = statusResult.status;
    latestPackageVersion = statusResult.latestPackageVersion;
    installedPackagePolicies = statusResult.installedPackagePolicies;
    healthyAgents = statusResult.healthyAgents;
  } catch (error) {
    logger.warn(`Failed to get cloud defend status: ${error.message}`);
  }

  return {
    alerts,
    file,
    process,
    latestPackageVersion,
    packageStatus: {
      status,
      installedPackagePolicies,
      healthyAgents,
    },
  };
};
