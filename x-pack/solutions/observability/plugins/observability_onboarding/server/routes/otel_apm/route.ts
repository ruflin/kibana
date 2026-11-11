/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuidv4 } from 'uuid';
import * as t from 'io-ts';
import Boom from '@hapi/boom';
import { createManagedOtlpServiceApiKey } from '../../lib/api_key/create_managed_otlp_service_api_key';
import { hasLogMonitoringPrivileges } from '../../lib/api_key/has_log_monitoring_privileges';
import { createObservabilityOnboardingServerRoute } from '../create_observability_onboarding_server_route';
import { getManagedOtlpServiceUrl } from '../../lib/get_managed_otlp_service_url';
import {
  isNoShardsAvailableError,
  throwHasDataSearchError,
} from '../../lib/handle_has_data_search_error';
import { checkPreExistingData } from '../../lib/check_pre_existing_data';
import { hasDocuments } from '../../lib/esql';

const createOtelApmOnboardingFlowRoute = createObservabilityOnboardingServerRoute({
  endpoint: 'POST /internal/observability_onboarding/otel_apm/flow',
  security: {
    authz: {
      enabled: false,
      reason: 'Authorization is checked by custom logic using Elasticsearch client',
    },
  },
  async handler(resources): Promise<{
    onboardingId: string;
    apiKeyEncoded: string;
    managedOtlpServiceUrl: string;
  }> {
    const { context, plugins } = resources;
    const {
      elasticsearch: { client },
    } = await context.core;

    const hasPrivileges = await hasLogMonitoringPrivileges(client.asCurrentUser, true);

    if (!hasPrivileges) {
      throw Boom.forbidden(
        "You don't have enough privileges to start a new onboarding flow. Contact your system administrator to grant you the required privileges."
      );
    }

    const { encoded: apiKeyEncoded } = await createManagedOtlpServiceApiKey(
      client.asCurrentUser,
      'ingest-otel-apm'
    );

    return {
      onboardingId: uuidv4(),
      apiKeyEncoded,
      managedOtlpServiceUrl: getManagedOtlpServiceUrl(plugins),
    };
  },
});

const hasOtelApmDataRoute = createObservabilityOnboardingServerRoute({
  endpoint: 'GET /internal/observability_onboarding/otel_apm/has-data',
  params: t.type({
    query: t.intersection([t.type({ start: t.string }), t.partial({ serviceName: t.string })]),
  }),
  security: {
    authz: {
      enabled: false,
      reason: 'Authorization is checked by Elasticsearch',
    },
  },
  async handler(resources): Promise<{ hasData: boolean; hasPreExistingData?: boolean }> {
    const { start, serviceName } = resources.params.query;
    const { elasticsearch } = await resources.context.core;

    const apmIndices = [
      'traces-apm*',
      'traces-*.otel-*',
      'logs-apm*',
      'logs-*.otel-*',
      'metrics-apm*',
      'metrics-*.otel-*',
      'apm-*',
    ];

    try {
      const [preExisting, hasData] = await Promise.all([
        checkPreExistingData(elasticsearch.client.asCurrentUser, apmIndices, start),
        hasDocuments({
          esClient: elasticsearch.client.asCurrentUser,
          indices: apmIndices,
          terms: serviceName ? [{ field: 'service.name', value: serviceName }] : [],
          // `start` is client-supplied, so the range stays a request filter (Query DSL).
          filter: { range: { '@timestamp': { gte: start } } },
        }),
      ]);

      return { hasData, hasPreExistingData: preExisting || undefined };
    } catch (error) {
      if (isNoShardsAvailableError(error)) {
        return { hasData: false };
      }

      throwHasDataSearchError(error);
    }
  },
});

export const otelApmOnboardingRouteRepository = {
  ...createOtelApmOnboardingFlowRoute,
  ...hasOtelApmDataRoute,
};
