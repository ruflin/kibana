/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR } from '@kbn/management-settings-ids';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import { createServerRoute } from '../../../create_server_route';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import {
  discoverySettingsSOType,
  DISCOVERY_SETTINGS_SO_ID,
  type DiscoverySettingsAttributes,
} from '../../../../lib/saved_objects/significant_events/discovery_settings';

const getDiscoverySettingsRoute = createServerRoute({
  endpoint: 'GET /internal/streams/_discovery/_settings',
  options: {
    access: 'internal',
    summary: 'Get discovery settings',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  handler: async ({ request, getScopedClients, server }) => {
    const { licensing, uiSettingsClient, soClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    let settings: DiscoverySettingsAttributes = {};
    try {
      const so = await soClient.get<DiscoverySettingsAttributes>(
        discoverySettingsSOType,
        DISCOVERY_SETTINGS_SO_ID
      );
      settings = so.attributes;
    } catch {
      // Not found — return defaults
    }

    let defaultConnectorId: string | undefined;
    try {
      const val = await uiSettingsClient.get<string>(GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR);
      if (val && val !== 'NO_DEFAULT_CONNECTOR') {
        defaultConnectorId = val;
      }
    } catch {
      // No default configured
    }

    return {
      featureExtractionConnectorId: settings.featureExtractionConnectorId ?? defaultConnectorId,
      queryGenerationConnectorId: settings.queryGenerationConnectorId ?? defaultConnectorId,
      discoveryConnectorId: settings.discoveryConnectorId ?? defaultConnectorId,
      suggestionConnectorId: settings.suggestionConnectorId ?? defaultConnectorId,
      onboardingFeatureExtractionConnectorId:
        settings.onboardingFeatureExtractionConnectorId ?? defaultConnectorId,
      onboardingSigEventsConnectorId: settings.onboardingSigEventsConnectorId ?? defaultConnectorId,
      topologyConnectorId: settings.topologyConnectorId ?? defaultConnectorId,
      enableMetricsTraces: settings.enableMetricsTraces ?? false,
      defaultConnectorId,
    };
  },
});

const updateDiscoverySettingsRoute = createServerRoute({
  endpoint: 'PUT /internal/streams/_discovery/_settings',
  options: {
    access: 'internal',
    summary: 'Update discovery settings',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    body: z.object({
      featureExtractionConnectorId: z.string().optional(),
      queryGenerationConnectorId: z.string().optional(),
      discoveryConnectorId: z.string().optional(),
      suggestionConnectorId: z.string().optional(),
      onboardingFeatureExtractionConnectorId: z.string().optional(),
      onboardingSigEventsConnectorId: z.string().optional(),
      topologyConnectorId: z.string().optional(),
      enableMetricsTraces: z.boolean().optional(),
    }),
  }),
  handler: async ({ params, request, getScopedClients, server }) => {
    const { licensing, uiSettingsClient, soClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    let existing: DiscoverySettingsAttributes = {};
    try {
      const so = await soClient.get<DiscoverySettingsAttributes>(
        discoverySettingsSOType,
        DISCOVERY_SETTINGS_SO_ID
      );
      existing = so.attributes;
    } catch {
      // Not found — will create
    }

    const merged: DiscoverySettingsAttributes = {
      ...existing,
      ...params.body,
    };

    await soClient.create(discoverySettingsSOType, merged, {
      id: DISCOVERY_SETTINGS_SO_ID,
      overwrite: true,
    });

    return { acknowledged: true };
  },
});

export const internalDiscoverySettingsRoutes = {
  ...getDiscoverySettingsRoute,
  ...updateDiscoverySettingsRoute,
};
