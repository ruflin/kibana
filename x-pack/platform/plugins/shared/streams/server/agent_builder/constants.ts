/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';

export const SIG_DISCOVERY_AGENT_ID = `${internalNamespaces.streams}.sig_discovery_agent`;

export const STREAMS_AGENT_BUILDER_TOOL_IDS = [
  `${internalNamespaces.streams}.search_discoveries`,
  `${internalNamespaces.streams}.get_discovery`,
  `${internalNamespaces.streams}.create_discovery`,
  `${internalNamespaces.streams}.run_discovery_pipeline`,
  `${internalNamespaces.streams}.list_entities`,
  `${internalNamespaces.streams}.get_stream_features`,
  `${internalNamespaces.streams}.upsert_features`,
  `${internalNamespaces.streams}.get_sig_events_queries`,
  `${internalNamespaces.streams}.upsert_sig_events_queries`,
  `${internalNamespaces.streams}.get_sig_events_with_change_points`,
  `${internalNamespaces.streams}.push_entity_definition`,
  `${internalNamespaces.streams}.promote_queries`,
  `${internalNamespaces.streams}.search_events`,
  `${internalNamespaces.streams}.get_log_patterns`,
  `${internalNamespaces.streams}.run_log_rate_analysis`,
  `${internalNamespaces.streams}.get_query_results`,
  `${internalNamespaces.streams}.get_query_definitions`,
] as const;
