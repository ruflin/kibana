/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ContextEnginePluginSetup } from '@kbn/context-engine-plugin/server';
import { SIGNIFICANT_EVENTS_AI_INDEX_EXTRACTION_WORKFLOW_ID } from '@kbn/workflows/managed';
import {
  SIGNIFICANT_EVENTS_AI_INDEX_DEST,
  SIGNIFICANT_EVENTS_AI_INDEX_ID,
} from '../../../common/constants';

/**
 * Registers the managed Significant Events AI Index when Context Engine is present.
 * No-op if the plugin is not installed. Persistence is gated by
 * `contextEngine:enabled` inside Context Engine start.
 */
export function registerSignificantEventsAiIndex(
  contextEngine: ContextEnginePluginSetup | undefined
): void {
  contextEngine?.registerAiIndex(SIGNIFICANT_EVENTS_AI_INDEX_ID, {
    description:
      'Knowledge Indicators extracted from Streams for Agent Builder retrieval (features, detections, index metadata).',
    dest: { type: 'index', value: SIGNIFICANT_EVENTS_AI_INDEX_DEST },
    automations: [
      { type: 'workflow', value: SIGNIFICANT_EVENTS_AI_INDEX_EXTRACTION_WORKFLOW_ID },
    ],
    sources: [],
  });
}
