/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { BuiltinToolDefinition } from '@kbn/agent-builder-server';
import { createErrorResult, createOtherResult } from '@kbn/agent-builder-server';
import type { CoreSetup } from '@kbn/core/server';
import type { PluginStartDependencies } from '../../types';
import { callStreamContext } from './call_streams_internal';

const STREAMS_MOUNT_PATH = '/streams';

const schema = z.object({
  stream: z.string().describe('Name of the stream to load (features and queries context)'),
});

export const loadStreamContextToolId = `${internalNamespaces.streams}.load_stream_context`;

export const loadStreamContextTool = (
  coreSetup: CoreSetup<PluginStartDependencies>
): BuiltinToolDefinition<typeof schema> => ({
  id: loadStreamContextToolId,
  type: ToolType.builtin,
  description: `Load context (features and significant-event queries) for a Streams stream and write it to the filestore at ${STREAMS_MOUNT_PATH}/{stream}.json so you can read it later with the filestore read tool. Use when you need detailed stream features and queries for analysis or correlation.`,
  schema,
  tags: ['streams', 'filestore'],
  handler: async ({ stream }, { request, spaceId, logger, writeStreamContext }) => {
    if (!writeStreamContext) {
      return {
        results: [
          createErrorResult({
            message:
              'load_stream_context requires filestore with streams volume; writeStreamContext is not available.',
          }),
        ],
      };
    }
    try {
      const [core] = await coreSetup.getStartServices();
      const data = await callStreamContext(request, core, spaceId, stream);
      const path = `${STREAMS_MOUNT_PATH}/${encodeURIComponent(stream)}.json`;
      await writeStreamContext(path, JSON.stringify(data, null, 2));
      return {
        results: [
          createOtherResult({
            type: 'load_stream_context',
            data: {
              path,
              stream: data.stream,
              features_count: data.features.length,
              queries_count: data.queries.length,
              message: `Stream context written to ${path}. Use filestore read with path "${path}" to read it.`,
            },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`load_stream_context failed: ${message}`);
      return {
        results: [
          createErrorResult({
            message: `Failed to load stream context: ${message}. Ensure Streams plugin is enabled and you have access.`,
          }),
        ],
      };
    }
  },
});
