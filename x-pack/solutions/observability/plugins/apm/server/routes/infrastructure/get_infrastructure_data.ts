/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { rangeQuery, kqlQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { termsQuery } from '@kbn/es-query';
import { environmentQuery } from '../../../common/utils/environment_query';
import {
  SERVICE_NAME,
  CONTAINER_ID,
  KUBERNETES_POD_NAME,
  K8S_POD_NAME,
  HOST_NAME,
} from '../../../common/es_fields/apm';
import { boolFilter, getTopValues } from '../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { hasOpenTelemetryPrefix } from '../../../common/agent_name';

export const getInfrastructureData = async ({
  kuery,
  serviceName,
  agentName,
  environment,
  apmEventClient,
  start,
  end,
}: {
  kuery: string;
  agentName: string | undefined;
  serviceName: string;
  environment: string;
  apmEventClient: APMEventClient;
  start: number;
  end: number;
}) => {
  const isOtel = Boolean(agentName && hasOpenTelemetryPrefix(agentName));
  const k8sFilterField = isOtel ? K8S_POD_NAME : KUBERNETES_POD_NAME;

  const apm = { events: [ProcessorEvent.metric] };
  const filter = boolFilter(
    ...rangeQuery(start, end),
    ...environmentQuery(environment),
    ...kqlQuery(kuery)
  );
  const getValues = (field: string) =>
    getTopValues({
      apmEventClient,
      operationName: 'get_service_infrastructure',
      apm,
      field,
      size: 500,
      where: [[SERVICE_NAME, serviceName]],
      filter,
    });

  const [containerIdsOfService, hostNames, podNames] = await Promise.all([
    getValues(CONTAINER_ID),
    getValues(HOST_NAME),
    getValues(k8sFilterField),
  ]);
  let containerIds = containerIdsOfService;

  if (podNames.length > 0 && isOtel) {
    containerIds = await getTopValues({
      apmEventClient,
      operationName: 'get_container_ids_by_pod_names',
      apm,
      field: CONTAINER_ID,
      size: 500,
      filter: boolFilter(
        ...rangeQuery(start, end),
        ...kqlQuery(kuery),
        ...termsQuery(k8sFilterField, podNames)
      ),
      skipProcessorEventFilter: true,
    });
  }

  return {
    containerIds,
    hostNames,
    podNames,
  };
};
