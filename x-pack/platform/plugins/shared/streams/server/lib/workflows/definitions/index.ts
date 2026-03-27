/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function loadYaml(filename: string): string {
  return readFileSync(join(__dirname, filename), 'utf-8');
}

export const WORKFLOW_NAMES = {
  featuresIdentification: 'streams-features-identification',
} as const;

export type WorkflowKey = keyof typeof WORKFLOW_NAMES;

export const WORKFLOW_YAMLS: Record<WorkflowKey, string> = {
  featuresIdentification: loadYaml('features_identification.yaml.text'),
};
