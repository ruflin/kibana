/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common';
import type { ToolHandlerContext, ToolHandlerReturn } from '@kbn/agent-builder-server';
import { z } from '@kbn/zod';
import type { BuiltinSkillBoundedTool } from '@kbn/agent-builder-server/skills/tools';

export interface SkillExecutionContext {
  request: KibanaRequest;
}

export type SkillExecutionHandler = (
  input: { params: Record<string, unknown>; connectorId?: string },
  context: SkillExecutionContext
) => Promise<Record<string, unknown>>;

const executeToolSchema = z.object({
  params: z.record(z.unknown()).optional().default({}),
  connectorId: z.string().optional(),
});

export const createExecuteTool = (
  skillId: string,
  description: string,
  handler: SkillExecutionHandler
): BuiltinSkillBoundedTool => ({
  id: `${skillId}.execute`,
  type: 'builtin' as unknown as ToolType.builtin,
  description,
  schema: executeToolSchema,
  handler: async (
    args: { params?: Record<string, unknown>; connectorId?: string },
    context: ToolHandlerContext
  ): Promise<ToolHandlerReturn> => {
    const result = await handler(
      { params: args.params ?? {}, connectorId: args.connectorId },
      { request: context.request }
    );
    return {
      results: [
        {
          tool_result_id: `${skillId}-result`,
          type: ToolResultType.other,
          data: result,
        },
      ],
    };
  },
});
