/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { UnifiedDocViewerStart } from '@kbn/unified-doc-viewer-plugin/public';

export interface UnifiedDocViewerAiPluginSetup {}

export interface UnifiedDocViewerAiPluginStart {}

export interface UnifiedDocViewerAiPluginSetupDeps {
  unifiedDocViewer: UnifiedDocViewerStart;
}

export interface UnifiedDocViewerAiPluginStartDeps {
  unifiedDocViewer: UnifiedDocViewerStart;
}

