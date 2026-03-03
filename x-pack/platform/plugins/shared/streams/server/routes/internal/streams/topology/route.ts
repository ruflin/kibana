/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { MessageRole } from '@kbn/inference-common';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import { createServerRoute } from '../../../create_server_route';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import { resolveConnectorId } from '../../../utils/resolve_connector_id';

const TOPOLOGY_SYSTEM_PROMPT = `You are an expert at creating Mermaid diagrams that visualize system topology and data flow.
Given a set of stream features (fields, entities, relationships, patterns), generate a Mermaid diagram that shows:
- The main data streams and their relationships
- Key entities (hosts, services, users) and how they connect
- Data flow direction
- Important field groupings or patterns

Rules:
- Use \`graph TD\` (top-down) or \`graph LR\` (left-right) depending on what fits best
- Keep the diagram readable — group related nodes, use subgraphs for streams
- Use meaningful labels, not raw field names
- Include at most 30 nodes to keep it readable
- Return ONLY the Mermaid diagram code, no explanation or markdown fences`;

const generateTopologyRoute = createServerRoute({
  endpoint: 'POST /internal/streams/_topology',
  options: {
    access: 'internal',
    summary: 'Generate a topology Mermaid diagram from stream features',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    body: z.object({
      connectorId: z.string().optional(),
    }),
  }),
  handler: async ({ params, request, getScopedClients, server, logger }) => {
    const { licensing, uiSettingsClient, featureClient, streamsClient, inferenceClient } =
      await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const connectorId = await resolveConnectorId({
      connectorId: params.body.connectorId,
      uiSettingsClient,
      logger,
    });

    let features;
    try {
      const streams = await streamsClient.listStreams();
      const streamNames = streams.map((s) => s.name);
      const result = await featureClient.getAllFeatures(streamNames);
      features = result.hits;
    } catch (e) {
      logger.warn(`Failed to fetch features for topology: ${e.message}`);
      features = [];
    }

    if (features.length === 0) {
      return {
        mermaid: 'graph TD\n  A[No features available] --> B[Extract features first]',
      };
    }

    const featureSummary = features.map((f) => ({
      id: f.id,
      title: f.title ?? f.id,
      type: f.type,
      subtype: f.subtype,
      stream_name: f.stream_name,
      description: f.description,
      confidence: f.confidence,
    }));

    const boundClient = inferenceClient.bindTo({ connectorId });

    const response = await boundClient.chatComplete({
      system: TOPOLOGY_SYSTEM_PROMPT,
      messages: [
        {
          role: MessageRole.User,
          content: `Here are the stream features:\n\n${JSON.stringify(featureSummary, null, 2)}\n\nGenerate a Mermaid diagram showing the topology of these streams, their entities, and relationships.`,
        },
      ],
    });

    let mermaidCode = response.content ?? '';
    mermaidCode = mermaidCode
      .replace(/^```mermaid\s*/i, '')
      .replace(/^```\s*/m, '')
      .replace(/```\s*$/m, '')
      .trim();

    return { mermaid: mermaidCode };
  },
});

export const internalTopologyRoutes = {
  ...generateTopologyRoute,
};
