/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-plugin/server';
import { createStreamsAnalysisSkill } from './streams_analysis';
import { createFeatureRefinementSkill } from './feature_refinement';
import { createQueryOptimizationSkill } from './query_optimization';
import { createObservabilityCorrelationSkill } from './observability_correlation';

export const registerSkills = async (agentBuilder: AgentBuilderPluginSetup): Promise<void> => {
  await Promise.all([
    agentBuilder.skills.register(createStreamsAnalysisSkill()),
    agentBuilder.skills.register(createFeatureRefinementSkill()),
    agentBuilder.skills.register(createQueryOptimizationSkill()),
    agentBuilder.skills.register(createObservabilityCorrelationSkill()),
  ]);
};
