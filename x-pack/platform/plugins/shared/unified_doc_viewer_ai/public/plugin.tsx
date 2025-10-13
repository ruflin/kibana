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
} from '@kbn/core/public';
import { i18n } from '@kbn/i18n';
import React from 'react';
import type {
  UnifiedDocViewerAiPluginSetup,
  UnifiedDocViewerAiPluginStart,
  UnifiedDocViewerAiPluginSetupDeps,
  UnifiedDocViewerAiPluginStartDeps,
} from './types';
import { DocViewerAi } from './components/doc_viewer_ai';

export class UnifiedDocViewerAiPlugin
  implements
    Plugin<
      UnifiedDocViewerAiPluginSetup,
      UnifiedDocViewerAiPluginStart,
      UnifiedDocViewerAiPluginSetupDeps,
      UnifiedDocViewerAiPluginStartDeps
    >
{
  constructor(initializerContext: PluginInitializerContext) {}

  public setup(
    core: CoreSetup,
    plugins: UnifiedDocViewerAiPluginSetupDeps
  ): UnifiedDocViewerAiPluginSetup {
    return {};
  }

  public start(
    core: CoreStart,
    plugins: UnifiedDocViewerAiPluginStartDeps
  ): UnifiedDocViewerAiPluginStart {
    const { unifiedDocViewer } = plugins;

    // Add the AI doc view tab (no license check)
    try {
      unifiedDocViewer.registry.add({
        id: 'doc_view_ai',
        title: i18n.translate('xpack.unifiedDocViewerAi.docViews.ai.aiTitle', {
          defaultMessage: 'AI',
        }),
        order: 30, // After Table (10) and JSON (20)
        component: (props) => <DocViewerAi {...props} />,
      });
    } catch (error) {
      // If already registered, ignore
      if (!error.message?.includes('already registered')) {
        // eslint-disable-next-line no-console
        console.error('Failed to register AI doc view:', error);
      }
    }

    return {};
  }

  public stop() {}
}

