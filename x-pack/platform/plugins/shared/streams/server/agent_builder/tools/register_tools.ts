/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ZodObject } from '@kbn/zod';
import type { StaticToolRegistration } from '@kbn/agent-builder-server';
import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-plugin/server';
import type { StreamsToolsDependencies } from './types';
import { createSearchDiscoveriesTool } from './search_discoveries';
import { createGetDiscoveryTool } from './get_discovery';
import { createCreateDiscoveryTool } from './create_discovery';
import { createRunDiscoveryPipelineTool } from './run_discovery_pipeline';
import { createListEntitiesTool } from './list_entities';
import { createGetStreamFeaturesTool } from './get_stream_features';
import { createUpsertFeaturesTool } from './upsert_features';
import { createGetSigEventsQueriesTool } from './get_sig_events_queries';
import { createUpsertSigEventsQueriesTool } from './upsert_sig_events_queries';
import { createGetSigEventsWithChangePointsTool } from './get_sig_events_with_change_points';
import { createPushEntityDefinitionTool } from './push_entity_definition';
import { createPromoteQueriesTool } from './promote_queries';

export const registerTools = (
  agentBuilder: AgentBuilderPluginSetup,
  deps: StreamsToolsDependencies
): void => {
  const tools: Array<StaticToolRegistration<ZodObject<Record<string, never>>>> = [
    createSearchDiscoveriesTool({ deps }),
    createGetDiscoveryTool({ deps }),
    createCreateDiscoveryTool({ deps }),
    createRunDiscoveryPipelineTool({ deps }),
    createListEntitiesTool({ deps }),
    createGetStreamFeaturesTool({ deps }),
    createUpsertFeaturesTool({ deps }),
    createGetSigEventsQueriesTool({ deps }),
    createUpsertSigEventsQueriesTool({ deps }),
    createGetSigEventsWithChangePointsTool({ deps }),
    createPushEntityDefinitionTool({ deps }),
    createPromoteQueriesTool({ deps }),
  ];

  for (const tool of tools) {
    agentBuilder.tools.register(tool);
  }

  deps.logger.debug(`Registered ${tools.length} Streams tools in Agent Builder`);
};
