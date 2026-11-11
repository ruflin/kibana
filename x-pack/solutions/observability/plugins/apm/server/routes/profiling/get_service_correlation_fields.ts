/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { rangeQuery } from '@kbn/observability-plugin/server';
import type { ApmServiceTransactionDocumentType } from '../../../common/document_type';
import {
  CONTAINER_ID,
  HOST_HOSTNAME,
  HOST_NAME,
  KUBERNETES_DEPLOYMENT_NAME,
  SERVICE_NAME,
} from '../../../common/es_fields/apm';
import type { RollupInterval } from '../../../common/rollup';
import { environmentQuery } from '../../../common/utils/environment_query';
import { boolFilter, getTopValues } from '../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

export async function getServiceCorrelationFields({
  apmEventClient,
  serviceName,
  start,
  end,
  environment,
  documentType,
  rollupInterval,
}: {
  environment: string;
  serviceName: string;
  start: number;
  end: number;
  apmEventClient: APMEventClient;
  documentType: ApmServiceTransactionDocumentType;
  rollupInterval: RollupInterval;
}) {
  const apm = { sources: [{ documentType, rollupInterval }] };
  const filter = boolFilter(...rangeQuery(start, end), ...environmentQuery(environment));
  const getValues = (field: string) =>
    getTopValues({
      apmEventClient,
      operationName: 'get_service_host_names',
      apm,
      field,
      size: 500,
      where: [[SERVICE_NAME, serviceName]],
      filter,
    });

  const [hostHostNames, hostNamesOfService, containerIds, deploymentNames] = await Promise.all([
    getValues(HOST_HOSTNAME),
    getValues(HOST_NAME),
    getValues(CONTAINER_ID),
    getValues(KUBERNETES_DEPLOYMENT_NAME),
  ]);

  const hostNames = new Set<string>([...hostHostNames, ...hostNamesOfService]);

  return {
    hostNames: Array.from(hostNames),
    containerIds,
    // Profiling samples carry the Kubernetes workload name as `orchestrator.resource.name`. Prefer
    // the deployment name when the collector enriched the APM data with it; otherwise fall back to
    // the service name, which is what the workload is called in most deployments.
    workloadNames: deploymentNames.length > 0 ? deploymentNames : [serviceName],
  };
}
