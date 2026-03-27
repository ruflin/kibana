/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { WorkflowsExtensionsServerPluginSetup } from '@kbn/workflows-extensions/server';
import type { GetScopedClients } from '../../../routes/types';
import { getFetchSampleDocumentsStepDefinition } from './fetch_sample_documents_step';
import { getIdentifyFeaturesStepDefinition } from './identify_features_step';
import { getGenerateComputedFeaturesStepDefinition } from './generate_computed_features_step';
import { getReconcileAndPersistFeaturesStepDefinition } from './reconcile_and_persist_features_step';

export function registerStreamsWorkflowSteps(
  workflowsExtensions: WorkflowsExtensionsServerPluginSetup,
  getScopedClients: GetScopedClients
) {
  workflowsExtensions.registerStepDefinition(
    getFetchSampleDocumentsStepDefinition(getScopedClients)
  );
  workflowsExtensions.registerStepDefinition(getIdentifyFeaturesStepDefinition(getScopedClients));
  workflowsExtensions.registerStepDefinition(
    getGenerateComputedFeaturesStepDefinition(getScopedClients)
  );
  workflowsExtensions.registerStepDefinition(
    getReconcileAndPersistFeaturesStepDefinition(getScopedClients)
  );
}
