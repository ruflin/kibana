/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Matches `SIGNIFICANT_EVENTS_MANAGED_WORKFLOW_OWNER` in `server/plugin.ts`. */
export const SIGNIFICANT_EVENTS_MANAGED_BY = 'significantEvents';

export const WORKFLOWS_EXECUTIONS_INDEX = '.workflows-executions';
export const CHAT_CONVERSATIONS_INDEX = '.chat-conversations';

export const SIGNIFICANT_EVENTS_AGENT_ID_PREFIX = 'significant-events.';

/** Cap for the two-pass tool-call trace.id join. */
export const TOOL_TRACE_ID_LIMIT = 10_000;

export const buildAgentBuilderTracesIndexPattern = (spaceId: string): string =>
  `traces-agent_builder.otel-${spaceId}`;
