/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../../../create_server_route';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import { semanticCorrelate } from '../../../../lib/semantic_correlation/semantic_correlate';

const semanticCorrelateRoute = createServerRoute({
  endpoint: 'POST /internal/streams/semantic_correlate',
  options: {
    access: 'internal',
    summary: 'Semantic correlation over features, optional queries and insights',
    description:
      'Runs semantic search over .kibana_streams_features (and optionally .kibana_streams_assets and .kibana_streams_insights) and returns ranked features, queries, and insights for the given natural-language query.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    body: z.object({
      query: z.string().describe('Natural-language query (e.g. alert rule name or question)'),
      stream: z.string().optional().describe('Optional stream name to scope results'),
      size: z.number().min(1).max(50).optional().default(10),
      include_queries: z.boolean().optional().default(false),
      include_insights: z.boolean().optional().default(false),
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
    logger,
  }) => {
    const { scopedClusterClient, licensing, uiSettingsClient } = await getScopedClients({
      request,
    });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const { query, stream, size, include_queries, include_insights } = params.body;
    return semanticCorrelate(
      scopedClusterClient.asCurrentUser,
      {
        query,
        stream,
        size,
        includeQueries: include_queries,
        includeInsights: include_insights,
      },
      logger
    );
  },
});

export const internalSemanticCorrelateRoutes = {
  ...semanticCorrelateRoute,
};
