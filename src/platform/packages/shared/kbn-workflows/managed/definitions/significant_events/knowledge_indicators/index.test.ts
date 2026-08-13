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
  SIGNIFICANT_EVENTS_KI_FEATURES_IDENTIFICATION_WORKFLOW,
  SIGNIFICANT_EVENTS_KI_QUERIES_GENERATION_WORKFLOW,
} from '.';

interface WorkflowStep {
  name: string;
  type?: string;
  'agent-id'?: string;
  'connector-id-by-feature'?: string;
  'create-conversation'?: boolean;
  'public-conversation'?: boolean;
  steps?: WorkflowStep[];
}

interface ParsedWorkflow {
  steps: WorkflowStep[];
}

const findStep = (steps: WorkflowStep[], name: string): WorkflowStep | undefined => {
  for (const step of steps) {
    if (step.name === name) return step;
    const nested = step.steps ? findStep(step.steps, name) : undefined;
    if (nested) return nested;
  }
};

const requireStep = (workflow: ParsedWorkflow, name: string): WorkflowStep => {
  const step = findStep(workflow.steps, name);
  if (!step) throw new Error(`Expected workflow step ${name}`);
  return step;
};

describe('KI agent workflow contracts', () => {
  it('bumps managed workflow versions when swapping LLM HTTP steps for agents', () => {
    expect(SIGNIFICANT_EVENTS_KI_FEATURES_IDENTIFICATION_WORKFLOW.version).toBe(4);
    expect(SIGNIFICANT_EVENTS_KI_QUERIES_GENERATION_WORKFLOW.version).toBe(3);
  });

  it('runs query generation as a public KI Query Generator conversation', () => {
    const workflow = parse(
      SIGNIFICANT_EVENTS_KI_QUERIES_GENERATION_WORKFLOW.yaml
    ) as ParsedWorkflow;
    const step = requireStep(workflow, 'generate_queries');

    expect(step.type).toBe('ai.agent');
    expect(step['agent-id']).toBe('significant-events.ki-queries');
    expect(step['connector-id-by-feature']).toBe('significant_events_ki_query_generation');
    expect(step['create-conversation']).toBe(true);
    expect(step['public-conversation']).toBe(true);
    expect(requireStep(workflow, 'persist_queries').type).toBe('kibana.request');
  });

  it('runs feature extraction as a public KI Feature Extractor conversation', () => {
    const workflow = parse(
      SIGNIFICANT_EVENTS_KI_FEATURES_IDENTIFICATION_WORKFLOW.yaml
    ) as ParsedWorkflow;
    const step = requireStep(workflow, 'extract_features');

    expect(step.type).toBe('ai.agent');
    expect(step['agent-id']).toBe('significant-events.ki-extraction');
    expect(step['connector-id-by-feature']).toBe('significant_events_ki_extraction');
    expect(step['create-conversation']).toBe(true);
    expect(step['public-conversation']).toBe(true);
    expect(requireStep(workflow, 'identify_computed').type).toBe('kibana.request');
    expect(findStep(workflow.steps, 'identify_loop')).toBeUndefined();
  });
});
