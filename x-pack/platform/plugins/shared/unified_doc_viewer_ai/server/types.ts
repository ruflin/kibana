/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IRouter, Logger } from '@kbn/core/server';
import type {
  PluginSetupContract as ActionsPluginSetup,
  PluginStartContract as ActionsPluginStart,
} from '@kbn/actions-plugin/server';
import type { DataPluginStart } from '@kbn/data-plugin/server';

export interface UnifiedDocViewerAiPluginSetup {}

export interface UnifiedDocViewerAiPluginStart {}

export interface UnifiedDocViewerAiPluginSetupDeps {
  actions: ActionsPluginSetup;
}

export interface UnifiedDocViewerAiPluginStartDeps {
  actions: ActionsPluginStart;
  data: DataPluginStart;
}

export interface RouteHandlerContext {
  router: IRouter;
  logger: Logger;
  actions: ActionsPluginStart;
}

