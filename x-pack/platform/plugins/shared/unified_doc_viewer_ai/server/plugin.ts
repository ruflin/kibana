/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
} from '@kbn/core/server';

import type {
  UnifiedDocViewerAiPluginSetup,
  UnifiedDocViewerAiPluginStart,
  UnifiedDocViewerAiPluginSetupDeps,
  UnifiedDocViewerAiPluginStartDeps,
} from './types';
import { registerExplainDocumentRoute } from './routes/explain_document';

export class UnifiedDocViewerAiPlugin
  implements
    Plugin<
      UnifiedDocViewerAiPluginSetup,
      UnifiedDocViewerAiPluginStart,
      UnifiedDocViewerAiPluginSetupDeps,
      UnifiedDocViewerAiPluginStartDeps
    >
{
  private readonly logger: Logger;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(
    core: CoreSetup<UnifiedDocViewerAiPluginStartDeps>,
    plugins: UnifiedDocViewerAiPluginSetupDeps
  ): UnifiedDocViewerAiPluginSetup {
    this.logger.debug('unified_doc_viewer_ai: Setup');

    const router = core.http.createRouter();

    // Register routes
    registerExplainDocumentRoute(router, this.logger, async () => {
      const [, startPlugins] = await core.getStartServices();
      return {
        actions: startPlugins.actions,
        data: startPlugins.data,
      };
    });

    return {};
  }

  public start(
    core: CoreStart,
    plugins: UnifiedDocViewerAiPluginStartDeps
  ): UnifiedDocViewerAiPluginStart {
    this.logger.debug('unified_doc_viewer_ai: Started');
    return {};
  }

  public stop() {}
}

