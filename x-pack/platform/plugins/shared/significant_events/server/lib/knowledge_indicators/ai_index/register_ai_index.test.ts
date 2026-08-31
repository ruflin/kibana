/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  SIGNIFICANT_EVENTS_KI_CONTINUOUS_ONBOARDING_WORKFLOW_ID,
  SIGNIFICANT_EVENTS_KI_ONBOARDING_WORKFLOW_ID,
  SIGNIFICANT_EVENTS_KI_SYNC_WORKFLOW_ID,
} from '@kbn/workflows/managed';
import { NIGHTSHIFT_AI_INDEX_DEST, NIGHTSHIFT_AI_INDEX_ID } from './constants';
import { registerNightshiftAiIndex } from './register_ai_index';

describe('registerNightshiftAiIndex', () => {
  it('registers a managed index-backed dest when contextEngine is present', () => {
    const registerAiIndex = jest.fn();

    registerNightshiftAiIndex({ registerAiIndex });

    expect(registerAiIndex).toHaveBeenCalledTimes(1);
    expect(registerAiIndex).toHaveBeenCalledWith(NIGHTSHIFT_AI_INDEX_ID, {
      description: expect.stringContaining('Nightshift knowledge'),
      dest: { type: 'index', value: NIGHTSHIFT_AI_INDEX_DEST },
      sources: [],
      automations: [
        { type: 'workflow', value: SIGNIFICANT_EVENTS_KI_ONBOARDING_WORKFLOW_ID },
        { type: 'workflow', value: SIGNIFICANT_EVENTS_KI_CONTINUOUS_ONBOARDING_WORKFLOW_ID },
        { type: 'workflow', value: SIGNIFICANT_EVENTS_KI_SYNC_WORKFLOW_ID },
      ],
    });
  });

  it('does not throw when contextEngine is absent', () => {
    expect(() => registerNightshiftAiIndex(undefined)).not.toThrow();
  });
});
