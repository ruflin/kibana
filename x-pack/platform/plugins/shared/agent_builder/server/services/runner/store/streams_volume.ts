/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FileEntryType } from '@kbn/agent-builder-server/runner/filestore';
import { estimateTokens } from '@kbn/agent-builder-genai-utils/tools/utils/token_count';
import type { MemoryVolume } from './filesystem';

export const STREAMS_MOUNT_PATH = '/streams';

/**
 * Write stream context to the streams volume. Path must be under /streams/.
 * Used by the load_stream_context tool (filestore option 3).
 */
export function createWriteStreamContext(
  streamsVolume: MemoryVolume,
  streamsMountPath: string
): (path: string, content: string) => Promise<void> {
  return async (path: string, content: string) => {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (!normalized.startsWith(`${streamsMountPath}/`) || normalized.includes('..')) {
      throw new Error(
        `Stream context path must start with ${streamsMountPath}/ and must not contain '..'`
      );
    }
    const plainText = content;
    const raw = (() => {
      try {
        return JSON.parse(content) as object;
      } catch {
        return { raw: content };
      }
    })();
    streamsVolume.add({
      type: 'file',
      path: normalized,
      content: { raw, plain_text: plainText },
      metadata: {
        type: FileEntryType.streamContext,
        id: normalized,
        token_count: estimateTokens(plainText),
        readonly: false,
      },
    });
  };
}
