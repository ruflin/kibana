/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { IScopedClusterClient, Logger } from '@kbn/core/server';

import type { Connector } from '@kbn/search-connectors';
import {
  CONNECTORS_JOBS_INDEX,
  fetchConnectorByIndexName,
  SyncStatus,
} from '@kbn/search-connectors';

import { ENTERPRISE_SEARCH_CONNECTOR_CRAWLER_SERVICE_TYPE } from '../../../common/constants';
import type { ElasticsearchIndexWithIngestion } from '../../../common/types/indices';
import {
  esqlCount,
  isEsqlUnknownIndexException,
  runEsql,
  toEsqlSource,
} from '../../utils/esql_helpers';
import { isIndexNotFoundException } from '../../utils/identify_exceptions';

import { mapIndexStats } from './utils/map_index_stats';

const hasInProgressSyncs = async (
  client: IScopedClusterClient,
  connectorId: string
): Promise<{ inProgress: boolean; pending: boolean }> => {
  try {
    // Filter on the connector id and the two statuses; the search returned the default 10 hits.
    const syncs = await runEsql(
      client.asCurrentUser,
      esql.from([toEsqlSource(CONNECTORS_JOBS_INDEX)]).where`connector.id == ${{
        connectorId,
      }} AND status IN (${[SyncStatus.IN_PROGRESS, SyncStatus.PENDING].map((status) =>
        esql.str(status)
      )})`.pipe`KEEP status`.limit(10)
    );
    const statuses = syncs.values.map(([status]) => status);
    const inProgress = statuses.includes(SyncStatus.IN_PROGRESS);
    const pending = statuses.includes(SyncStatus.PENDING);
    return { inProgress, pending };
  } catch (error) {
    if (isIndexNotFoundException(error) || isEsqlUnknownIndexException(error)) {
      return { inProgress: false, pending: false };
    }
    throw error;
  }
};

export const fetchIndex = async (
  client: IScopedClusterClient,
  index: string,
  logger: Logger
): Promise<ElasticsearchIndexWithIngestion> => {
  const indexDataResult = await client.asCurrentUser.indices.get({ index });
  const indexData = indexDataResult[index];
  const { indices } = await client.asCurrentUser.indices.stats({ index });

  const count = await esqlCount(client.asCurrentUser, index);

  if (!indices || !indices[index] || !indexData) {
    throw new Error('404');
  }
  const indexStats = indices[index];
  let connector: Connector | undefined;
  try {
    connector = await fetchConnectorByIndexName(client.asCurrentUser, index);
  } catch (error) {
    logger.error(`Error fetching connector for index ${index}: ${error}`);
  }
  const hasInProgressSyncsResult = connector
    ? await hasInProgressSyncs(client, connector.id)
    : { inProgress: false, pending: false };

  const indexResult = {
    count,
    ...mapIndexStats(indexData, indexStats, index),
    has_in_progress_syncs: hasInProgressSyncsResult.inProgress,
    has_pending_syncs: hasInProgressSyncsResult.pending,
  };

  if (connector && connector.service_type !== ENTERPRISE_SEARCH_CONNECTOR_CRAWLER_SERVICE_TYPE) {
    return {
      ...indexResult,
      connector,
    };
  }

  return indexResult;
};
