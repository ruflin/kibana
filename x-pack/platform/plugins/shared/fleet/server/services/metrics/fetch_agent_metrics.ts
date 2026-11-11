/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import type { CoreSetup } from '@kbn/core/server';
import { esql } from '@elastic/esql';

import { AGENTS_INDEX } from '../../../common';

import type { AgentPerVersion, AgentUsage } from '../../collectors/agent_collectors';
import { getAgentUsage } from '../../collectors/agent_collectors';
import { getInternalClients } from '../../collectors/helpers';
import { appContextService } from '../app_context';
import { retryTransientEsErrors } from '../epm/elasticsearch/retry';
import { esqlRows, runEsqlRead } from '../esql_read';

// The default size of the DSL `terms` aggregations these counts came from
const TOP_BUCKETS = 10;

export interface AgentMetrics {
  agents: AgentUsage;
  agents_per_version: AgentPerVersion[];
  upgrading_step: UpgradingSteps;
  unhealthy_reason: UnhealthyReason;
}

export interface UpgradingSteps {
  requested: number;
  scheduled: number;
  downloading: number;
  extracting: number;
  replacing: number;
  restarting: number;
  watching: number;
  rollback: number;
  failed: number;
}

export interface UnhealthyReason {
  input: number;
  output: number;
  other: number;
}

export const fetchAgentMetrics = async (
  core: CoreSetup,
  signal: AbortSignal
): Promise<AgentMetrics | undefined> => {
  const [soClient, esClient] = await getInternalClients(core);
  if (!soClient || !esClient) {
    return;
  }

  const fleetAgentsIndexExists = await esClient.indices.exists({
    index: AGENTS_INDEX,
  });

  if (!fleetAgentsIndexExists) {
    return;
  }

  const usage = {
    agents: await getAgentUsage(soClient, esClient),
    agents_per_version: await getAgentsPerVersion(esClient, signal),
    upgrading_step: await getUpgradingSteps(esClient, signal),
    unhealthy_reason: await getUnhealthyReason(esClient, signal),
  };

  return usage;
};

export const getAgentsPerVersion = async (
  esClient: ElasticsearchClient,
  signal: AbortSignal
): Promise<AgentPerVersion[]> => {
  try {
    // The 10 most common versions, as the default size of the DSL `terms` aggregation did.
    const response = await retryTransientEsErrors(() =>
      runEsqlRead({
        esClient,
        query: esql.from([AGENTS_INDEX]).where`active == TRUE AND agent.version IS NOT NULL`
          .pipe`STATS doc_count = COUNT(*) BY agent.version`
          .pipe`SORT doc_count DESC, agent.version ASC`.limit(TOP_BUCKETS),
        ignoreUnknownIndex: true,
        signal,
      })
    );
    if (!response) {
      appContextService.getLogger().debug('Index .fleet-agents does not exist yet.');
    }
    return esqlRows(response).map((row) => ({
      version: row['agent.version'] as string,
      count: row.doc_count as number,
    }));
  } catch (error) {
    if (error.statusCode === 404) {
      appContextService.getLogger().debug('Index .fleet-agents does not exist yet.');
    } else {
      throw error;
    }
    return [];
  }
};

export const getUpgradingSteps = async (
  esClient: ElasticsearchClient,
  signal: AbortSignal
): Promise<UpgradingSteps> => {
  const upgradingSteps = {
    requested: 0,
    scheduled: 0,
    downloading: 0,
    extracting: 0,
    replacing: 0,
    restarting: 0,
    watching: 0,
    rollback: 0,
    failed: 0,
  };
  try {
    const response = await retryTransientEsErrors(() =>
      runEsqlRead({
        esClient,
        query: esql.from([AGENTS_INDEX]).where`active == TRUE AND upgrade_details.state IS NOT NULL`
          .pipe`STATS doc_count = COUNT(*) BY upgrade_details.state`
          .pipe`SORT doc_count DESC, upgrade_details.state ASC`.limit(TOP_BUCKETS),
        ignoreUnknownIndex: true,
        signal,
      })
    );
    if (!response) {
      appContextService.getLogger().debug('Index .fleet-agents does not exist yet.');
    }
    esqlRows(response).forEach((bucket) => {
      switch (bucket['upgrade_details.state']) {
        case 'UPG_REQUESTED':
          upgradingSteps.requested = bucket.doc_count as number;
          break;
        case 'UPG_SCHEDULED':
          upgradingSteps.scheduled = bucket.doc_count as number;
          break;
        case 'UPG_DOWNLOADING':
          upgradingSteps.downloading = bucket.doc_count as number;
          break;
        case 'UPG_EXTRACTING':
          upgradingSteps.extracting = bucket.doc_count as number;
          break;
        case 'UPG_REPLACING':
          upgradingSteps.replacing = bucket.doc_count as number;
          break;
        case 'UPG_RESTARTING':
          upgradingSteps.restarting = bucket.doc_count as number;
          break;
        case 'UPG_WATCHING':
          upgradingSteps.watching = bucket.doc_count as number;
          break;
        case 'UPG_ROLLBACK':
          upgradingSteps.rollback = bucket.doc_count as number;
          break;
        case 'UPG_FAILED':
          upgradingSteps.failed = bucket.doc_count as number;
          break;
        default:
          break;
      }
    });
    return upgradingSteps;
  } catch (error) {
    if (error.statusCode === 404) {
      appContextService.getLogger().debug('Index .fleet-agents does not exist yet.');
    } else {
      throw error;
    }
    return upgradingSteps;
  }
};

export const getUnhealthyReason = async (
  esClient: ElasticsearchClient,
  signal: AbortSignal
): Promise<UnhealthyReason> => {
  const unhealthyReason = {
    input: 0,
    output: 0,
    other: 0,
  };
  try {
    const response = await retryTransientEsErrors(() =>
      runEsqlRead({
        esClient,
        query: esql.from([AGENTS_INDEX]).where`unhealthy_reason IS NOT NULL`
          .pipe`STATS doc_count = COUNT(*) BY unhealthy_reason`
          .pipe`SORT doc_count DESC, unhealthy_reason ASC`.limit(TOP_BUCKETS),
        ignoreUnknownIndex: true,
        signal,
      })
    );
    if (!response) {
      appContextService.getLogger().debug('Index .fleet-agents does not exist yet.');
    }
    esqlRows(response).forEach((bucket) => {
      switch (bucket.unhealthy_reason) {
        case 'input':
          unhealthyReason.input = bucket.doc_count as number;
          break;
        case 'output':
          unhealthyReason.output = bucket.doc_count as number;
          break;
        case 'other':
          unhealthyReason.other = bucket.doc_count as number;
          break;
        default:
          break;
      }
    });
    return unhealthyReason;
  } catch (error) {
    if (error.statusCode === 404) {
      appContextService.getLogger().debug('Index .fleet-agents does not exist yet.');
    } else {
      throw error;
    }
    return unhealthyReason;
  }
};
