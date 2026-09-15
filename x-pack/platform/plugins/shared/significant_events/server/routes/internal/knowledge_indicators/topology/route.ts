/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import {
  MAX_ID_LENGTH,
  SIGNIFICANT_EVENTS_KI_EXTRACTION_INFERENCE_FEATURE_ID,
} from '@kbn/significant-events-schema';
import { createServerRoute } from '../../../create_server_route';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import { assertNotPaused } from '../../../utils/assert_not_paused';
import { getRequestAbortSignal } from '../../../utils/get_request_abort_signal';
import { resolveConnectorForFeature } from '../../../utils/resolve_connector_for_feature';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import { regenerateTopology } from '../../../../lib/significant_events/topology/regenerate_topology';

const MAX_STREAM_NAMES = 1000;

const generateTopologyRoute = createServerRoute({
  endpoint: 'POST /internal/streams/knowledge_indicators/topology/_generate',
  options: {
    access: 'internal',
    summary: 'Generate topology knowledge indicators',
    description:
      'Regenerates entity, technology, infrastructure, and dependency knowledge indicators from existing knowledge indicators and persists them so the topology map can refresh in place.',
    timeout: { idleSocket: 300_000 },
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    body: z
      .object({
        streamNames: z.array(z.string().max(MAX_ID_LENGTH)).max(MAX_STREAM_NAMES).optional(),
        connectorId: z.string().max(MAX_ID_LENGTH).optional(),
      })
      .optional(),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
    logger,
    maintenanceService,
  }): Promise<{ streamNames: string[]; createdCount: number; connectorId: string }> => {
    const scopedClients = await getScopedClients({ request });
    const { licensing, streamsClient, inferenceClient } = scopedClients;

    await assertSignificantEventsAccess({ server, licensing });
    await assertNotPaused({ maintenanceService, request });

    const kiClient = await scopedClients.getKnowledgeIndicatorClient();
    const routeLogger = logger.get('topology', 'generate');
    const body = params?.body;
    const connectorId =
      body?.connectorId ??
      (await resolveConnectorForFeature({
        searchInferenceEndpoints: server.searchInferenceEndpoints,
        featureId: SIGNIFICANT_EVENTS_KI_EXTRACTION_INFERENCE_FEATURE_ID,
        featureName: 'knowledge indicator extraction',
        request,
      }));

    return regenerateTopology({
      requestedStreamNames: body?.streamNames,
      connectorId,
      kiClient,
      listStreamNames: async () => {
        const streams = await streamsClient.listStreams();
        return streams.map((stream) => stream.name);
      },
      inferenceClient,
      logger: routeLogger,
      signal: getRequestAbortSignal(request),
    });
  },
});

export const internalTopologyRoutes = {
  ...generateTopologyRoute,
};
