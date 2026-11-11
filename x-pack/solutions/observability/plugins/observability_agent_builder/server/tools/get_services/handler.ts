/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest, Logger } from '@kbn/core/server';
import type { IScopedClusterClient } from '@kbn/core-elasticsearch-server';
import { ML_ANOMALY_SEVERITY } from '@kbn/ml-anomaly-utils/anomaly_severity';
import { getSeverityType } from '@kbn/ml-anomaly-utils/get_severity_type';
import { esql } from '@elastic/esql';
import { kqlQuery } from '@kbn/observability-utils-server/es/queries/kql_query';
import type { ObservabilityAgentBuilderDataRegistry } from '../../data_registry/data_registry';
import type { ServicesItemsItem } from '../../data_registry/data_registry_types';
import type {
  ObservabilityAgentBuilderCoreSetup,
  ObservabilityAgentBuilderPluginSetupDependencies,
} from '../../types';
import { getLogsIndices } from '../../utils/get_logs_indices';
import { getMetricsIndices } from '../../utils/get_metrics_indices';
import { esqlRows, runEsqlRead, toEsqlSources } from '../../utils/esql_read';
import { parseDatemath, toMilliseconds } from '../../utils/time';

interface ServiceFromIndex {
  serviceName: string;
  environment?: string;
}

const MAX_SERVICES_FROM_INDICES = 500;

async function getServicesFromLogsAndMetricsIndices({
  esClient,
  logsIndices,
  metricsIndices,
  start,
  end,
  kqlFilter,
  logger,
}: {
  esClient: IScopedClusterClient;
  logsIndices: string[];
  metricsIndices: string[];
  start: number;
  end: number;
  kqlFilter?: string;
  logger: Logger;
}): Promise<ServiceFromIndex[]> {
  const allIndices = [...logsIndices, ...metricsIndices];

  if (allIndices.length === 0) {
    return [];
  }

  try {
    // Highest document count first: the services are cut at the limit by total count, and the
    // reported environment is the one with the most documents (nulls ranked last).
    const response = await runEsqlRead({
      esClient: esClient.asCurrentUser,
      query: esql.from(toEsqlSources(allIndices)).pipe`WHERE service.name IS NOT NULL`
        .pipe`STATS doc_count = COUNT(*) BY service.name, service.environment`
        .pipe`EVAL env_rank = CASE(service.environment IS NULL, 0, -doc_count)`
        .pipe`STATS total = SUM(doc_count), environment = FIRST(service.environment, env_rank) BY service.name`
        .pipe`SORT total DESC, service.name ASC`.pipe`LIMIT ${{
        limit: MAX_SERVICES_FROM_INDICES,
      }}`,
      filter: {
        bool: {
          filter: [{ range: { '@timestamp': { gte: start, lte: end } } }, ...kqlQuery(kqlFilter)],
        },
      },
    });

    return esqlRows(response).map((row) => ({
      serviceName: String(row['service.name']),
      environment: typeof row.environment === 'string' ? row.environment : undefined,
    }));
  } catch (error) {
    logger.debug(`Failed to get services from indices: ${error.message}`);
    return [];
  }
}

function mergeServices({
  apmServices,
  logsAndMetricsServices,
}: {
  apmServices: ServicesItemsItem[];
  logsAndMetricsServices: ServiceFromIndex[];
}): ServicesItemsItem[] {
  const serviceMap = new Map<string, ServicesItemsItem>();

  for (const service of apmServices) {
    serviceMap.set(service.serviceName, service);
  }

  for (const service of logsAndMetricsServices) {
    if (!serviceMap.has(service.serviceName)) {
      serviceMap.set(service.serviceName, {
        serviceName: service.serviceName,
        environments: service.environment ? [service.environment] : undefined,
      });
    }
  }

  return Array.from(serviceMap.values());
}

export async function getToolHandler({
  core,
  plugins,
  request,
  esClient,
  dataRegistry,
  logger,
  start,
  end,
  anomalySeverities,
  kqlFilter,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  plugins: ObservabilityAgentBuilderPluginSetupDependencies;
  request: KibanaRequest;
  esClient: IScopedClusterClient;
  dataRegistry: ObservabilityAgentBuilderDataRegistry;
  logger: Logger;
  start: string;
  end: string;
  anomalySeverities?: ML_ANOMALY_SEVERITY[];
  kqlFilter?: string;
}): Promise<{
  services: ServicesItemsItem[];
  maxCountExceeded: boolean;
  serviceOverflowCount: number;
}> {
  const startMs = parseDatemath(start);
  const endMs = parseDatemath(end, { roundUp: true });

  const [logsIndices, metricsIndices] = await Promise.all([
    getLogsIndices({ core, logger }),
    getMetricsIndices({ core, plugins, logger }),
  ]);

  const [apmResponse, logsAndMetricsServices] = await Promise.all([
    dataRegistry.getData('servicesItems', {
      request,
      kuery: kqlFilter,
      start,
      end,
    }),
    getServicesFromLogsAndMetricsIndices({
      esClient,
      logsIndices,
      metricsIndices,
      start: startMs,
      end: endMs,
      kqlFilter,
      logger,
    }),
  ]);

  const apmServices = apmResponse?.items ?? [];

  const normalizedApmServices = apmServices
    .filter((service) => {
      if (!anomalySeverities?.length) return true;
      const severity =
        service.anomalyScore === undefined
          ? ML_ANOMALY_SEVERITY.UNKNOWN
          : getSeverityType(service.anomalyScore);
      return anomalySeverities.includes(severity);
    })
    .map((service) => ({
      ...service,
      anomalySeverity:
        service.anomalyScore !== undefined
          ? getSeverityType(service.anomalyScore)
          : ML_ANOMALY_SEVERITY.UNKNOWN,
      latency: toMilliseconds(service.latency ?? null),
    }));

  // Merge all services from different sources
  const services = mergeServices({
    apmServices: normalizedApmServices,
    logsAndMetricsServices: anomalySeverities?.length ? [] : logsAndMetricsServices,
  });

  return {
    services,
    maxCountExceeded: apmResponse?.maxCountExceeded ?? false,
    serviceOverflowCount: apmResponse?.serviceOverflowCount ?? 0,
  };
}
