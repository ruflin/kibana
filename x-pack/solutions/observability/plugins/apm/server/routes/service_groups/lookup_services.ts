/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type { LookupServicesResponse } from '@kbn/apm-api-shared';
import type { ApmDataSourceWithSummary } from '@kbn/apm-types';
import { getPreferredBucketSizeAndDataSource } from '@kbn/apm-data-access-plugin/common';
import type { AgentName } from '../../../typings/es_schemas/ui/fields/agent';
import { AGENT_NAME, SERVICE_ENVIRONMENT, SERVICE_NAME } from '../../../common/es_fields/apm';
import { esqlRows } from '../../lib/helpers/esql_read';
import { MAX_ESQL_TERMS } from '../../lib/helpers/esql_values';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

/** A `terms` aggregation returns ten environments unless asked for more. */
const ENVIRONMENTS_PER_SERVICE = 10;

export async function lookupServices({
  apmEventClient,
  kuery,
  start,
  end,
  maxNumberOfServices,
  sources,
}: {
  apmEventClient: APMEventClient;
  kuery: string;
  start: number;
  end: number;
  maxNumberOfServices: number;
  sources: ApmDataSourceWithSummary[];
}): Promise<LookupServicesResponse> {
  const { source } = getPreferredBucketSizeAndDataSource({
    sources,
    bucketSizeInSeconds: (end - start) / 1000,
  });
  const { documentType, rollupInterval } = source;
  const apm = { sources: [{ documentType, rollupInterval }] };
  const filter = { bool: { filter: [...rangeQuery(start, end), ...kqlQuery(kuery)] } };

  // The services with the most documents first, with the agent of their latest document.
  const servicesResponse = await apmEventClient.esql('lookup_services', {
    apm,
    query: (index) =>
      esql.from(index).pipe`STATS doc_count = COUNT(*), agent_name = LAST(${esql.col(
        AGENT_NAME
      )}, @timestamp) BY ${esql.col(SERVICE_NAME)}`.pipe`SORT doc_count DESC, ${esql.col(
        SERVICE_NAME
      )} ASC`.limit(maxNumberOfServices),
    filter,
  });
  const services = esqlRows(servicesResponse);

  if (services.length === 0) {
    return [];
  }

  // The environments of those services, most documents first, at most ENVIRONMENTS_PER_SERVICE each.
  const environmentsResponse = await apmEventClient.esql('lookup_services_environments', {
    apm,
    query: (index) =>
      esql.from(index).pipe`WHERE ${esql.col(SERVICE_NAME)} IN (${{
        serviceNames: services.map((service) => service[SERVICE_NAME] as string),
      }})`.pipe`WHERE ${esql.col(SERVICE_ENVIRONMENT)} IS NOT NULL`
        .pipe`STATS doc_count = COUNT(*) BY ${esql.col(SERVICE_NAME)}, ${esql.col(
        SERVICE_ENVIRONMENT
      )}`.pipe`SORT doc_count DESC, ${esql.col(SERVICE_ENVIRONMENT)} ASC`.limit(MAX_ESQL_TERMS),
    filter,
  });

  const environmentsByService = new Map<string, string[]>();
  for (const row of esqlRows(environmentsResponse)) {
    const serviceName = row[SERVICE_NAME] as string;
    const environments = environmentsByService.get(serviceName) ?? [];
    if (environments.length < ENVIRONMENTS_PER_SERVICE) {
      environments.push(row[SERVICE_ENVIRONMENT] as string);
    }
    environmentsByService.set(serviceName, environments);
  }

  return services.map((service) => {
    const serviceName = service[SERVICE_NAME] as string;
    return {
      serviceName,
      environments: environmentsByService.get(serviceName) ?? [],
      agentName: service.agent_name as AgentName,
    };
  });
}
