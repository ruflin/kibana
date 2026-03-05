/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import { createServerRoute } from '../../../create_server_route';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import {
  createSkillExecutionHandlers,
  type SkillExecutionDeps,
} from '../../../../agent_builder/skills/execution_handlers';

const SKILL_METADATA: Record<string, { name: string; description: string }> = {
  'streams.extract_stream_features': {
    name: 'Extract Stream Features',
    description: 'Extract features (systems, services, components) from stream data.',
  },
  'streams.generate_sig_events_queries': {
    name: 'Generate Sig Events Queries',
    description: 'Generate KQL and ES|QL queries for significant events detection.',
  },
  'streams.generate_discoveries': {
    name: 'Generate Discoveries',
    description: 'Run the discovery pipeline to analyze data and extract actionable discoveries.',
  },
  'streams.generate_suggestions': {
    name: 'Generate Suggestions',
    description: 'Generate ES|QL query suggestions from existing discoveries.',
  },
  'streams.investigate_stream': {
    name: 'Investigate Stream',
    description:
      'Run a full investigation: extract features, generate queries, and produce discoveries.',
  },
  'streams.push_entity_definition': {
    name: 'Push Entity Definition',
    description: 'Map features to entity definitions and push to the Entity Store.',
  },
};

const listSkillsRoute = createServerRoute({
  endpoint: 'GET /internal/streams/_skills',
  options: {
    access: 'internal',
    summary: 'List available skills',
    description: 'Returns all streams skills that support direct execution.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  handler: async ({
    request,
    getScopedClients,
    server,
  }): Promise<{
    skills: Array<{
      id: string;
      name: string;
      description: string;
      executable: boolean;
    }>;
  }> => {
    const { licensing, uiSettingsClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    return {
      skills: Object.entries(SKILL_METADATA).map(([id, meta]) => ({
        id,
        name: meta.name,
        description: meta.description,
        executable: id !== 'streams.push_entity_definition',
      })),
    };
  },
});

const executeSkillRoute = createServerRoute({
  endpoint: 'POST /internal/streams/_skills/{skillId}/_execute',
  options: {
    access: 'internal',
    summary: 'Execute a skill',
    description: 'Execute a streams skill programmatically.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      skillId: z.string(),
    }),
    body: z.object({
      params: z.record(z.unknown()).optional().default({}),
      connectorId: z.string().optional(),
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
    logger,
  }): Promise<{
    skill_id: string;
    status: string;
    result?: Record<string, unknown>;
    error?: string;
  }> => {
    const { licensing, uiSettingsClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const { path, body } = params;
    const { skillId } = path;

    const deps: SkillExecutionDeps = { getScopedClients, logger };
    const handlers = createSkillExecutionHandlers(deps);
    const handler = handlers[skillId];

    if (!handler) {
      return {
        skill_id: skillId,
        status: 'failed',
        error: `Unknown skill: '${skillId}'. Available skills: ${Object.keys(handlers).join(', ')}`,
      };
    }

    try {
      const result = await handler(
        { params: body.params, connectorId: body.connectorId },
        { request }
      );
      return {
        skill_id: skillId,
        status: 'accepted',
        result,
      };
    } catch (e) {
      logger.error(
        `Skill execution failed for '${skillId}': ${e instanceof Error ? e.message : String(e)}`
      );
      return {
        skill_id: skillId,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

export const internalSkillExecutionRoutes = {
  ...listSkillsRoute,
  ...executeSkillRoute,
};
