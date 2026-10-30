/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InferenceConnector } from '@kbn/inference-common';
import type { KIsOnboardingStep } from '@kbn/significant-events-schema';

export interface OnboardingConfig {
  steps: KIsOnboardingStep[];
  connectors: {
    features?: string;
    queries?: string;
  };
}

/** Which steps a generate run covers: both, features only or queries only. */
export type GenerateRun = 'all' | 'features' | 'queries';

/** Shared generate settings and the per-row run trigger, passed down to every source row. */
export interface RowGenerateProps {
  config: OnboardingConfig;
  allConnectors: InferenceConnector[];
  featuresResolvedConnectorId: string | undefined;
  queriesResolvedConnectorId: string | undefined;
  /** Page-level blocks: paused activity, catalog not loaded, or a schedule in flight. */
  isRunDisabled: boolean;
  onConfigChange: (config: OnboardingConfig) => void;
  onRun: (sourceId: string, run: GenerateRun) => void;
}
