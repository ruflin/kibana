/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ContextEnginePluginSetup } from '@kbn/context-engine-plugin/server';
import {
  SIGNIFICANT_EVENTS_KI_CONTINUOUS_ONBOARDING_WORKFLOW_ID,
  SIGNIFICANT_EVENTS_KI_ONBOARDING_WORKFLOW_ID,
  SIGNIFICANT_EVENTS_KI_SYNC_WORKFLOW_ID,
} from '@kbn/workflows/managed';
import { NIGHTSHIFT_AI_INDEX_DEST, NIGHTSHIFT_AI_INDEX_ID } from './constants';

/** Registers the managed Nightshift AI Index when Context Engine is available. */
export const registerNightshiftAiIndex = (
  contextEngine: ContextEnginePluginSetup | undefined
): void => {
  contextEngine?.registerAiIndex(NIGHTSHIFT_AI_INDEX_ID, {
    description:
      'Nightshift knowledge: stream features, detection queries, significant events, and memory pages.',
    dest: { type: 'index', value: NIGHTSHIFT_AI_INDEX_DEST },
    sources: [],
    automations: [
      { type: 'workflow', value: SIGNIFICANT_EVENTS_KI_ONBOARDING_WORKFLOW_ID },
      { type: 'workflow', value: SIGNIFICANT_EVENTS_KI_CONTINUOUS_ONBOARDING_WORKFLOW_ID },
      { type: 'workflow', value: SIGNIFICANT_EVENTS_KI_SYNC_WORKFLOW_ID },
    ],
  });
};
