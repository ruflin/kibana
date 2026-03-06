/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
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

const TOPOLOGY_SYSTEM_PROMPT = `You are an expert at creating Mermaid diagrams that visualize entity relationships and service dependencies.

You will receive stream features extracted from log data. Features have a \`type\` field that categorizes them:
- **entity** — services, databases, message queues, caches, and other system components (subtypes: service, database, message_queue, cache, api_gateway, load_balancer, storage, etc.)
- **dependency** — explicit relationships between entities (subtypes: service_dependency, database_connection, api_integration). Each dependency has \`source\` and \`target\` in its properties.
- **infrastructure** — cloud deployments, container orchestration, operating systems, networking
- **technology** — programming languages, frameworks, libraries, tools
- **schema** — log schema families (ECS, OTel, custom)

Your primary goal is to build a topology from the **entity** and **dependency** features. Infrastructure and technology features provide supporting context.

## Diagram structure

1. **Entity features are the nodes.** Every feature with \`type: "entity"\` MUST appear as a node. Use the feature title as the label and its subtype to pick the node shape:
   - Services/applications: rounded rectangle \`(Service Name)\`
   - Databases/stores: cylinder \`[(Database)]\`
   - Message queues: parallelogram \`[/Queue Name/]\`
   - Caches: stadium \`([Cache Name])\`
   - API gateways / load balancers: hexagon \`{{Gateway Name}}\`

2. **Dependency features are the edges.** Every feature with \`type: "dependency"\` MUST become a labeled edge between the source and target entities. Use the dependency subtype and properties to label the edge (e.g., "HTTP", "reads from", "publishes to").

3. **Infer additional edges** from entity metadata when dependencies are not explicitly captured — for example, if an entity's properties or meta mention another entity by name, draw a connection.

4. **Group by domain, not infrastructure.** Use subgraphs to group tightly coupled entities that form a logical domain (e.g., a service and its database, a set of microservices in the same bounded context). Only use infrastructure grouping when entities share a clear deployment boundary visible in the data.

5. **Infrastructure and technology as context.** Do NOT create nodes for infrastructure or technology features. Instead, use them to enrich entity labels or add subgraph titles (e.g., if entities share a Kubernetes namespace, name the subgraph after it).

## Color coding (use Mermaid inline styles)

- **Critical path** (core services, databases, load balancers): red fill — \`style NodeId fill:#f97066,stroke:#d63d2f,color:#fff\`
- **Application services** (API gateways, business logic): blue fill — \`style NodeId fill:#6ea8fe,stroke:#3d7bd9,color:#fff\`
- **Supporting** (monitoring, logging, background workers): gray fill — \`style NodeId fill:#adb5bd,stroke:#6c757d,color:#fff\`
- **External** (third-party APIs, cloud services): purple fill — \`style NodeId fill:#b197fc,stroke:#7c5cbf,color:#fff\`

## Active issue annotations

When active issues (discoveries) are provided, annotate affected entities:
- **Critical** issues: thick red dashed border — \`style NodeId stroke:#d63d2f,stroke-width:3px,stroke-dasharray: 5 5\`
- **High** issues: orange dashed border — \`style NodeId stroke:#e8790c,stroke-width:2px,stroke-dasharray: 5 5\`
- **Medium/low** issues: yellow dashed border — \`style NodeId stroke:#d4a017,stroke-width:2px,stroke-dasharray: 5 5\`
- Add a short issue summary as a note or label annotation on the affected node
- Match issues to entities using stream_refs and evidence feature_name fields

## Rules

- Use \`graph LR\` (left-right) to emphasize the dependency flow between entities
- Every entity feature MUST appear as a node; every dependency feature MUST appear as an edge
- Do NOT create nodes for infrastructure, technology, or schema features
- Label edges with the relationship type — never leave edges unlabeled
- Use meaningful human-readable labels from the feature title, not raw IDs
- Prioritize clarity: at most 30 nodes; collapse minor entities into group summaries if needed
- Assign colors to EVERY node based on its role
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

    const toSummary = (f: (typeof features)[number]) => ({
      id: f.id,
      title: f.title ?? f.id,
      type: f.type,
      subtype: f.subtype,
      stream_name: f.stream_name,
      description: f.description,
      properties: f.properties,
      confidence: f.confidence,
    });

    const entityFeatures = features.filter((f) => f.type === 'entity').map(toSummary);
    const dependencyFeatures = features.filter((f) => f.type === 'dependency').map(toSummary);
    const contextFeatures = features
      .filter((f) => f.type !== 'entity' && f.type !== 'dependency')
      .map(toSummary);

    let activeIssues: Array<{
      title: string;
      severity: string;
      relevance_score: number;
      stream_refs: string[];
      evidence: Array<{ feature_name?: string }>;
    }> = [];
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

    const sections: string[] = [];

    sections.push(
      `## Entities (type: "entity") — these are the NODES\nEvery entity below MUST appear as a node in the diagram.\n\n${JSON.stringify(entityFeatures, null, 2)}`
    );

    if (dependencyFeatures.length > 0) {
      sections.push(
        `## Dependencies (type: "dependency") — these are the EDGES\nEvery dependency below MUST appear as a labeled edge between its source and target.\n\n${JSON.stringify(dependencyFeatures, null, 2)}`
      );
    }

    if (contextFeatures.length > 0) {
      sections.push(
        `## Context features (infrastructure, technology, schema)\nUse these to enrich entity labels or subgraph names. Do NOT create nodes for these.\n\n${JSON.stringify(contextFeatures, null, 2)}`
      );
    }

    if (activeIssues.length > 0) {
      sections.push(
        `## Active Issues (discoveries)\nAnnotate affected entities with issue markers as described in the instructions.\n\n${JSON.stringify(activeIssues, null, 2)}`
      );
    }

    const response = await boundClient.chatComplete({
      system: TOPOLOGY_SYSTEM_PROMPT,
      messages: [
        {
          role: MessageRole.User,
          content: `${sections.join('\n\n')}\n\nGenerate a Mermaid topology diagram that:\n1. Creates a node for every entity feature, using the correct shape for its subtype\n2. Creates a labeled edge for every dependency feature between its source and target entities\n3. Infers additional edges from entity properties/descriptions when dependencies are not explicitly captured\n4. Groups tightly coupled entities into subgraphs by domain\n5. Colors every node by its role: critical path (red), application services (blue), supporting (gray), external (purple)\n6. Annotates entities affected by active issues with dashed borders and short issue summaries`,
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
