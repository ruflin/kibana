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
  SIGNIFICANT_EVENTS_KI_ONBOARDING_WORKFLOW,
} from '.';
import { createWorkflowLiquidEngine } from '../../../../common/utils';

interface WorkflowStep {
  name: string;
  steps?: WorkflowStep[];
  with?: Record<string, unknown>;
}

interface WorkflowInput {
  name: string;
  type?: string;
  default?: unknown;
}

interface ParsedWorkflow {
  steps: WorkflowStep[];
  triggers: Array<{ inputs?: WorkflowInput[] }>;
}

const features = parse(
  SIGNIFICANT_EVENTS_KI_FEATURES_IDENTIFICATION_WORKFLOW.yaml
) as ParsedWorkflow;
const onboarding = parse(SIGNIFICANT_EVENTS_KI_ONBOARDING_WORKFLOW.yaml) as ParsedWorkflow;

const DEFAULT_RATIO = 0.4;

const flattenSteps = (steps: WorkflowStep[]): WorkflowStep[] =>
  steps.flatMap((step) => [step, ...(step.steps ? flattenSteps(step.steps) : [])]);

const requireStep = (workflow: ParsedWorkflow, name: string): WorkflowStep => {
  const step = flattenSteps(workflow.steps).find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Expected workflow step ${name}`);
  return step;
};

const requireInput = (workflow: ParsedWorkflow, name: string): WorkflowInput => {
  const input = workflow.triggers[0]?.inputs?.find((candidate) => candidate.name === name);
  if (!input) throw new Error(`Expected workflow input ${name}`);
  return input;
};

// Renders a `${{ ... }}` template against the given inputs, as the workflow engine does.
const render = (template: unknown, inputs: Record<string, unknown>): unknown => {
  if (typeof template !== 'string') throw new Error('Expected a template string');
  return createWorkflowLiquidEngine().evalValueSync(template.slice(3, -2).trim(), { inputs });
};

const requestBody = (workflow: ParsedWorkflow, stepName: string, bodyKey: string) =>
  requireStep(workflow, stepName).with?.[bodyKey] as Record<string, unknown>;

describe('features identification entity and diverse sampling ratios', () => {
  it.each([
    ['features identification', features, 'entityFilteredRatio', 'diverseRatio'],
    ['onboarding', onboarding, 'featuresEntityFilteredRatio', 'featuresDiverseRatio'],
  ])('defaults the %s ratio inputs to 0.4', (_name, workflow, entityInput, diverseInput) => {
    expect(requireInput(workflow, entityInput)).toMatchObject({
      type: 'number',
      default: DEFAULT_RATIO,
    });
    expect(requireInput(workflow, diverseInput)).toMatchObject({
      type: 'number',
      default: DEFAULT_RATIO,
    });
  });

  it('forwards the onboarding ratios to the features identification inputs', () => {
    const inputs = requestBody(onboarding, 'identify_features', 'inputs');
    const overrides = { featuresEntityFilteredRatio: 0, featuresDiverseRatio: 0.25 };

    expect(render(inputs.entityFilteredRatio, overrides)).toBe(0);
    expect(render(inputs.diverseRatio, overrides)).toBe(0.25);
  });

  it('sends the features identification ratios in the prepare request', () => {
    const body = requestBody(features, 'prepare', 'body');
    const overrides = { entityFilteredRatio: 0, diverseRatio: 0.25 };

    expect(render(body.entityFilteredRatio, overrides)).toBe(0);
    expect(render(body.diverseRatio, overrides)).toBe(0.25);
  });

  it('sends the default ratios in the prepare request when nothing is overridden', () => {
    const handoff = requestBody(onboarding, 'identify_features', 'inputs');
    const onboardingDefaults = {
      featuresEntityFilteredRatio: requireInput(onboarding, 'featuresEntityFilteredRatio').default,
      featuresDiverseRatio: requireInput(onboarding, 'featuresDiverseRatio').default,
    };
    const featuresInputs = {
      entityFilteredRatio: render(handoff.entityFilteredRatio, onboardingDefaults),
      diverseRatio: render(handoff.diverseRatio, onboardingDefaults),
    };
    const body = requestBody(features, 'prepare', 'body');

    expect(render(body.entityFilteredRatio, featuresInputs)).toBe(DEFAULT_RATIO);
    expect(render(body.diverseRatio, featuresInputs)).toBe(DEFAULT_RATIO);
  });
});
