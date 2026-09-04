/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { parse } from 'yaml';
import {
  SIGNIFICANT_EVENTS_AI_INDEX_EXTRACTION_WORKFLOW,
  SIGNIFICANT_EVENTS_AI_INDEX_EXTRACTION_WORKFLOW_ID,
} from '.';

interface WorkflowStep {
  name: string;
  type?: string;
  'agent-id'?: string;
  with?: Record<string, unknown>;
  steps?: WorkflowStep[];
}

interface ParsedWorkflow {
  consts?: { ai_index_id?: string };
  steps: WorkflowStep[];
}

const walkSteps = (steps: WorkflowStep[], visit: (step: WorkflowStep) => void): void => {
  for (const step of steps) {
    visit(step);
    if (step.steps) {
      walkSteps(step.steps, visit);
    }
  }
};

const collectTypes = (steps: WorkflowStep[]): string[] => {
  const types: string[] = [];
  walkSteps(steps, (step) => {
    if (step.type) {
      types.push(step.type);
    }
  });
  return types;
};

describe('Significant Events AI Index extraction workflow', () => {
  const workflow = parse(
    SIGNIFICANT_EVENTS_AI_INDEX_EXTRACTION_WORKFLOW.yaml
  ) as ParsedWorkflow;

  it('is registered as a versioned managed workflow', () => {
    expect(SIGNIFICANT_EVENTS_AI_INDEX_EXTRACTION_WORKFLOW_ID).toBe(
      'system-significant-events-ai-index-extraction'
    );
    expect(SIGNIFICANT_EVENTS_AI_INDEX_EXTRACTION_WORKFLOW.version).toBe(1);
    expect(SIGNIFICANT_EVENTS_AI_INDEX_EXTRACTION_WORKFLOW.pluginId).toBe('significantEvents');
  });

  it('writes to the managed significant-events AI Index', () => {
    expect(workflow.consts?.ai_index_id).toBe('significant-events');
    expect(collectTypes(workflow.steps)).toEqual(
      expect.arrayContaining(['ai.prompt', 'context-engine.createKi', 'context-engine.verifyKi'])
    );
  });

  it('does not use the typed KI store persist path', () => {
    const types = collectTypes(workflow.steps);
    expect(types).not.toContain('kibana.request');
    expect(types).not.toContain('ai.agent');

    walkSteps(workflow.steps, (step) => {
      expect(step['agent-id']).toBeUndefined();
      const serialized = JSON.stringify(step.with ?? {});
      expect(serialized).not.toContain('/_identify');
      expect(serialized).not.toContain('/_generate');
      expect(serialized).not.toContain('/_persist');
    });
  });
});
