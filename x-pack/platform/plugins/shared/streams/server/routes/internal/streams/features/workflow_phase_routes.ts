/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SearchHit } from '@elastic/elasticsearch/lib/api/types';
import type { BaseFeature, Feature, IgnoredFeature } from '@kbn/streams-schema';
import { z } from '@kbn/zod/v4';
import { createServerRoute } from '../../../create_server_route';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import type {
  FetchSamplesPhaseResult,
  IdentifyPhaseResult,
  PersistPhaseResult,
} from '../../../../lib/workflows/feature_identification_phases';
import {
  executeComputedPhase,
  executeFetchSamplesPhase,
  executeIdentifyPhase,
  executePersistPhase,
} from '../../../../lib/workflows/feature_identification_phases';

export const fetchSamplesWorkflowPhaseRoute = createServerRoute({
  endpoint: 'POST /internal/streams/{name}/features/_workflow/fetch_samples',
  options: {
    access: 'internal',
    summary: 'Workflow phase: fetch sample documents for feature identification',
    description:
      'Fetches sample documents with entity-filter exclusion. Existing features are passed in by the workflow.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({ name: z.string() }),
    body: z.object({
      start: z.number(),
      end: z.number(),
      existing_features: z.array(z.unknown()).optional(),
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
  }): Promise<FetchSamplesPhaseResult> => {
    const { licensing, uiSettingsClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const logger = server.logger.get('features_workflow_identification');
    return executeFetchSamplesPhase({
      getScopedClients,
      request,
      streamName: params.path.name,
      start: params.body.start,
      end: params.body.end,
      existingFeatures: (params.body.existing_features ?? []) as Feature[],
      logger,
    });
  },
});

export const identifyWorkflowPhaseRoute = createServerRoute({
  endpoint: 'POST /internal/streams/{name}/features/_workflow/identify',
  options: {
    access: 'internal',
    summary: 'Workflow phase: LLM feature identification',
    description:
      'Runs inference on sample documents. Connector ID, prompt, and excluded features are passed in by the workflow.',
    timeout: { idleSocket: 5 * 60 * 1000 },
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({ name: z.string() }),
    body: z.object({
      documents: z.array(z.unknown()),
      connector_id: z.string().optional(),
      system_prompt: z.string().optional(),
      excluded_features: z.array(z.unknown()).optional(),
    }),
  }),
  handler: async ({ params, request, getScopedClients, server }): Promise<IdentifyPhaseResult> => {
    const { licensing, uiSettingsClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const logger = server.logger.get('features_workflow_identification');
    return executeIdentifyPhase({
      getScopedClients,
      request,
      streamName: params.path.name,
      documents: params.body.documents as Array<SearchHit<Record<string, unknown>>>,
      connectorId: params.body.connector_id,
      systemPrompt: params.body.system_prompt,
      excludedFeatures: (params.body.excluded_features ?? []) as Feature[],
      logger,
    });
  },
});

export const computedWorkflowPhaseRoute = createServerRoute({
  endpoint: 'POST /internal/streams/{name}/features/_workflow/computed',
  options: {
    access: 'internal',
    summary: 'Workflow phase: generate computed features',
    description: 'Runs ES aggregations and dataset analysis to generate computed features.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({ name: z.string() }),
    body: z.object({
      start: z.number(),
      end: z.number(),
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
  }): Promise<{ features: unknown[] }> => {
    const { licensing, uiSettingsClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const logger = server.logger.get('features_workflow_identification');
    return executeComputedPhase({
      getScopedClients,
      request,
      streamName: params.path.name,
      start: params.body.start,
      end: params.body.end,
      logger,
    });
  },
});

export const persistWorkflowPhaseRoute = createServerRoute({
  endpoint: 'POST /internal/streams/{name}/features/_workflow/persist',
  options: {
    access: 'internal',
    summary: 'Workflow phase: reconcile and persist features',
    description:
      'Merges inferred and computed features, deduplicates against existing/excluded, and bulk writes.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({ name: z.string() }),
    body: z.object({
      inferred_features: z.array(z.unknown()),
      computed_features: z.array(z.unknown()),
      ignored_features: z.array(z.unknown()),
    }),
  }),
  handler: async ({ params, request, getScopedClients, server }): Promise<PersistPhaseResult> => {
    const { licensing, uiSettingsClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const logger = server.logger.get('features_workflow_identification');
    return executePersistPhase({
      getScopedClients,
      request,
      streamName: params.path.name,
      inferred_features: params.body.inferred_features as BaseFeature[],
      computed_features: params.body.computed_features as BaseFeature[],
      ignored_features: params.body.ignored_features as IgnoredFeature[],
      logger,
    });
  },
});

export const featureWorkflowPhaseRoutes = {
  ...fetchSamplesWorkflowPhaseRoute,
  ...identifyWorkflowPhaseRoute,
  ...computedWorkflowPhaseRoute,
  ...persistWorkflowPhaseRoute,
};
