/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition, StaticToolRegistration } from '@kbn/agent-builder-server';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { StreamsToolsDependencies } from './types';

const runDiscoveryPipelineSchema = z.object({
  streamNames: z
    .array(z.string())
    .optional()
    .describe('Stream names to analyze. If empty, analyzes all streams.'),
  connectorId: z
    .string()
    .optional()
    .describe('AI connector ID to use. Falls back to the default connector if not specified.'),
});

export const RUN_DISCOVERY_PIPELINE_TOOL_ID = `${internalNamespaces.streams}.run_discovery_pipeline`;

export const createRunDiscoveryPipelineTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof runDiscoveryPipelineSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof runDiscoveryPipelineSchema> = {
    id: RUN_DISCOVERY_PIPELINE_TOOL_ID,
    type: ToolType.builtin,
    description: `Trigger the three-stage discovery pipeline on specified streams.

The pipeline:
1. Extracts discoveries from significant event data
2. Enriches discoveries with recommendations
3. Generates ES|QL query suggestions

When to use:
- Running a full analysis of significant events across streams
- Generating discoveries and suggestions from scratch
- Re-analyzing streams after new data arrives`,
    schema: runDiscoveryPipelineSchema,
    tags: ['streams', 'discoveries', 'pipeline'],
    handler: async (toolParams, { request, esClient }) => {
      try {
        const [coreStart, pluginsStart] = await deps.core.getStartServices();
        const inferenceClient = pluginsStart.inference.getClient({ request });
        const discoveryClient = await deps.getDiscoveryClient(request);

        const soClient = coreStart.savedObjects.getScopedClient(request);
        const uiSettingsClient = coreStart.uiSettings.asScopedToClient(soClient);

        const { resolveConnectorId } = await import('../../routes/utils/resolve_connector_id');
        const connectorId = await resolveConnectorId({
          connectorId: toolParams.connectorId,
          uiSettingsClient,
          logger: deps.logger,
        });

        const { generateDiscoveries } = await import(
          '../../lib/significant_events/discovery/generate_discoveries'
        );
        const { StreamsService } = await import('../../lib/streams/service');
        const { QueryService } = await import('../../lib/streams/assets/query/query_service');
        const { AttachmentService } = await import(
          '../../lib/streams/attachments/attachment_service'
        );
        const { SystemService } = await import('../../lib/streams/system/system_service');
        const { FeatureService } = await import('../../lib/streams/feature/feature_service');

        const streamsService = new StreamsService(deps.core, deps.logger, false);
        const queryService = new QueryService(deps.core, deps.logger);
        const attachmentService = new AttachmentService(deps.core, deps.logger);
        const systemService = new SystemService(deps.core, deps.logger);
        const featureService = new FeatureService(deps.core, deps.logger);

        const [attachmentClient, queryClient, systemClient, featureClient] = await Promise.all([
          attachmentService.getClientWithRequest({ request }),
          queryService.getClientWithRequest({ request }),
          systemService.getClientWithRequest({ request }),
          featureService.getClientWithRequest({ request }),
        ]);

        const streamsClient = await streamsService.getClientWithRequest({
          request,
          attachmentClient,
          queryClient,
          systemClient,
          featureClient,
        });

        const result = await generateDiscoveries({
          streamsClient,
          queryClient,
          esClient: esClient.asCurrentUser,
          scopedClusterClient: esClient,
          inferenceClient: inferenceClient.bindTo({ connectorId }),
          signal: new AbortController().signal,
          logger: deps.logger,
          streamNames: toolParams.streamNames,
          discoveryClient,
          featureClient,
          connectorId,
        });

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                discoveryCount: result.discoveries.length,
                suggestionCount: result.suggestions.length,
                tokensUsed: result.tokensUsed,
                discoveries: result.discoveries,
                suggestions: result.suggestions,
              },
            },
          ],
        };
      } catch (error) {
        deps.logger.error(`Discovery pipeline failed: ${error.message}`);
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Discovery pipeline failed: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
