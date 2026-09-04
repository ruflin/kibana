/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SIGNIFICANT_EVENTS_AI_INDEX_EXTRACTION_WORKFLOW_ID } from '@kbn/workflows/managed';
import {
  SIGNIFICANT_EVENTS_AI_INDEX_DEST,
  SIGNIFICANT_EVENTS_AI_INDEX_ID,
} from '../../../common/constants';
import { registerSignificantEventsAiIndex } from './register_ai_index';

describe('registerSignificantEventsAiIndex', () => {
  it('registers a managed AI Index pointing at the dest and extraction workflow', () => {
    const registerAiIndex = jest.fn();

    registerSignificantEventsAiIndex({ registerAiIndex });

    expect(registerAiIndex).toHaveBeenCalledTimes(1);
    expect(registerAiIndex).toHaveBeenCalledWith(SIGNIFICANT_EVENTS_AI_INDEX_ID, {
      description: expect.stringContaining('Agent Builder'),
      dest: { type: 'index', value: SIGNIFICANT_EVENTS_AI_INDEX_DEST },
      automations: [
        { type: 'workflow', value: SIGNIFICANT_EVENTS_AI_INDEX_EXTRACTION_WORKFLOW_ID },
      ],
      sources: [],
    });
  });

  it('does not throw when Context Engine is absent', () => {
    expect(() => registerSignificantEventsAiIndex(undefined)).not.toThrow();
  });
});
