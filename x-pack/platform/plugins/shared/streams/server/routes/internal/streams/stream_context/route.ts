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

/**
 * Returns features, significant-event queries, and recent insights for a stream.
 * Used by Agent Builder "load stream context" tool to persist to filestore.
 */
const streamContextRoute = createServerRoute({
  endpoint: 'GET /internal/streams/stream_context',
  options: {
    access: 'internal',
    summary: 'Get stream context (features, queries, and insights)',
    description:
      'Returns features, significant-event queries, and recent insights for the given stream for use by agents or persistence to filestore.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    query: z.object({
      stream: z.string().describe('Stream name'),
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
  }) => {
    const { featureClient, queryClient, insightClient, licensing, uiSettingsClient, streamsClient } =
      await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const streamName = params.query.stream;
    await streamsClient.ensureStream(streamName);

    const [featuresResponse, queries, insightsResponse] = await Promise.all([
      featureClient.getFeatures(streamName, { limit: 500 }),
      queryClient.getAssets(streamName),
      insightClient.getInsights(streamName, { limit: 50 }),
    ]);

    const features = featuresResponse.hits.map((f) => ({
      id: f.id,
      title: f.title,
      type: f.type,
      subtype: f.subtype,
      description: f.description,
      confidence: f.confidence,
      evidence: f.evidence,
    }));

    const querySummaries = queries.map((q) => ({
      id: q['asset.id'],
      title: q.query?.title,
      kql: q.query?.kql?.query,
      feature_name: q.query?.feature?.name,
    }));

    const insights = insightsResponse.hits.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      impact: i.impact,
      category: i.category,
      status: i.status,
      recommendations: i.recommendations,
    }));

    return {
      stream: streamName,
      features,
      queries: querySummaries,
      insights,
    };
  },
});

export const internalStreamContextRoutes = {
  ...streamContextRoute,
};
