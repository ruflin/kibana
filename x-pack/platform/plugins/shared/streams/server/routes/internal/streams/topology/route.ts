/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { MessageRole } from '@kbn/inference-common';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import {
  discoverySettingsSOType,
  DISCOVERY_SETTINGS_SO_ID,
  type DiscoverySettingsAttributes,
} from '../../../../lib/saved_objects/significant_events/discovery_settings';
import { createServerRoute } from '../../../create_server_route';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import { resolveConnectorId } from '../../../utils/resolve_connector_id';

const TOPOLOGY_SYSTEM_PROMPT = `You are an expert at creating Mermaid diagrams that visualize infrastructure topology, entity relationships, and service dependencies.

Given a set of stream features (services, hosts, components, patterns), generate a Mermaid diagram that shows:

1. **Entities** — Services, applications, hosts, and users discovered in the data. These are the primary nodes.
2. **Infrastructure** — The underlying infrastructure (clusters, cloud providers, regions, namespaces) that entities run on. Use subgraphs to group entities by their infrastructure.
3. **Dependencies** — How entities depend on each other: which services call which, what databases they connect to, what message queues they use, what APIs they consume.

Color coding by importance (use Mermaid style classes or inline styles):
- **Critical path** (core services, databases, load balancers): red/orange fill — \`style NodeId fill:#f97066,stroke:#d63d2f,color:#fff\`
- **Important** (application services, API gateways): blue fill — \`style NodeId fill:#6ea8fe,stroke:#3d7bd9,color:#fff\`
- **Supporting** (monitoring, logging, CI/CD, background workers): gray fill — \`style NodeId fill:#adb5bd,stroke:#6c757d,color:#fff\`
- **External** (third-party APIs, cloud services, CDNs): purple fill — \`style NodeId fill:#b197fc,stroke:#7c5cbf,color:#fff\`

Active issue annotations:
- When active issues (discoveries) are provided, annotate the affected nodes and edges
- For **critical** issues: use a thick red dashed border — \`style NodeId stroke:#d63d2f,stroke-width:3px,stroke-dasharray: 5 5\`
- For **high** issues: use an orange dashed border — \`style NodeId stroke:#e8790c,stroke-width:2px,stroke-dasharray: 5 5\`
- For **medium/low** issues: use a yellow dashed border — \`style NodeId stroke:#d4a017,stroke-width:2px,stroke-dasharray: 5 5\`
- Add a note or annotation next to affected nodes with a short issue summary (use Mermaid notes if possible, otherwise append to the node label)
- Match issues to nodes using the issue's stream_refs and evidence feature_name fields

Rules:
- Use \`graph LR\` (left-right) for service dependency flows, \`graph TD\` (top-down) for infrastructure hierarchy
- Use subgraphs to represent infrastructure boundaries (clusters, namespaces, cloud regions)
- Label edges with the relationship type (e.g., "calls", "reads from", "deploys to", "monitors")
- Use meaningful human-readable labels, not raw field names or IDs
- Prioritize clarity: include at most 30 nodes; collapse less important nodes into group summaries
- Assign colors to EVERY node based on its importance category
- Return ONLY the Mermaid diagram code, no explanation or markdown fences`;

const getTopologyRoute = createServerRoute({
  endpoint: 'GET /internal/streams/_topology',
  options: {
    access: 'internal',
    summary: 'Get the persisted topology Mermaid diagram',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  handler: async ({ request, getScopedClients, server }) => {
    const { licensing, uiSettingsClient, soClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    try {
      const so = await soClient.get<DiscoverySettingsAttributes>(
        discoverySettingsSOType,
        DISCOVERY_SETTINGS_SO_ID
      );
      return { mermaid: so.attributes.topologyMermaid ?? null };
    } catch {
      return { mermaid: null };
    }
  },
});

const generateTopologyRoute = createServerRoute({
  endpoint: 'POST /internal/streams/_topology',
  options: {
    access: 'internal',
    summary: 'Generate a topology Mermaid diagram from stream features and persist it',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    body: z.object({
      connectorId: z.string().optional(),
    }),
  }),
  handler: async ({ params, request, getScopedClients, server, logger }) => {
    const { licensing, uiSettingsClient, featureClient, streamsClient, inferenceClient, soClient, discoveryClient } =
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

    let activeIssues: Array<{ title: string; severity: string; relevance_score: number; stream_refs: string[]; evidence: Array<{ feature_name?: string }> }> = [];
    try {
      const discoveries = await discoveryClient.searchDiscoveries({
        minRelevanceScore: 30,
        size: 20,
      });
      activeIssues = discoveries.map((d) => ({
        title: d.title,
        severity: d.severity,
        relevance_score: d.relevance_score,
        stream_refs: d.stream_refs,
        evidence: (d.evidence ?? []).map((ev) => ({ feature_name: ev.feature_name })),
      }));
    } catch {
      // Discoveries may not be available yet
    }

    const boundClient = inferenceClient.bindTo({ connectorId });

    const issuesSection = activeIssues.length > 0
      ? `\n\nHere are the currently active issues (discoveries) that should be annotated on the diagram:\n\n${JSON.stringify(activeIssues, null, 2)}`
      : '';

    const response = await boundClient.chatComplete({
      system: TOPOLOGY_SYSTEM_PROMPT,
      messages: [
        {
          role: MessageRole.User,
          content: `Here are the discovered features from our data streams:\n\n${JSON.stringify(featureSummary, null, 2)}${issuesSection}\n\nGenerate a Mermaid topology diagram that:\n1. Identifies the key entities (services, hosts, applications) and their dependencies\n2. Groups them by infrastructure (clusters, namespaces, cloud providers)\n3. Shows how they connect and depend on each other\n4. Colors every node by importance: critical path (red), important services (blue), supporting (gray), external (purple)\n5. Annotates any nodes or edges affected by active issues — mark them with warning icons and dashed borders`,
        },
      ],
    });

    let mermaidCode = response.content ?? '';
    mermaidCode = mermaidCode
      .replace(/^```mermaid\s*/i, '')
      .replace(/^```\s*/m, '')
      .replace(/```\s*$/m, '')
      .trim();

    // Persist the generated topology
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

    await soClient.create(
      discoverySettingsSOType,
      { ...existing, topologyMermaid: mermaidCode },
      { id: DISCOVERY_SETTINGS_SO_ID, overwrite: true }
    );

    return { mermaid: mermaidCode };
  },
});

export const internalTopologyRoutes = {
  ...getTopologyRoute,
  ...generateTopologyRoute,
};
