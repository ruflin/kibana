/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Query keys for react-query
 */
export const queryKeys = {
  conversations: {
    /**
     * Broad prefix for invalidating any conversation list cache, regardless of agentId
     * or includeHidden. Use with `queryClient.invalidateQueries({ queryKey: ... })`.
     */
    all: ['conversations'] as const,
    /**
     * Specific list query key, parameterized by agentId and includeHidden so toggling
     * "Show hidden" caches its own entry rather than mutating the visible list in place.
     */
    list: (
      agentId: string | undefined,
      options: { includeHidden?: boolean } = {}
    ): readonly unknown[] => [
      'conversations',
      'list',
      { agentId, includeHidden: options.includeHidden ?? false },
    ],
    /**
     * @deprecated Use `queryKeys.conversations.list(agentId, { includeHidden })`.
     * Retained as a thin wrapper for callers that don't pass includeHidden.
     */
    byAgent: (agentId: string, options: { includeHidden?: boolean } = {}) =>
      queryKeys.conversations.list(agentId, options),
    byId: (conversationId: string) => ['conversations', conversationId],
  },
  agentProfiles: {
    all: ['agentProfiles'] as const,
    byId: (agentProfileId?: string) => ['agentProfiles', agentProfileId],
  },
  tools: {
    all: ['tools', 'list'] as const,
    typeInfo: ['tools', 'typeInfo'] as const,
    byId: (toolId?: string) => ['tools', toolId],
    indexSearch: {
      resolveTargets: (pattern: string) => ['tools', 'indexSearch', 'resolveTargets', pattern],
    },
    workflows: {
      byId: (workflowId?: string) => ['tools', 'workflows', workflowId],
      list: () => ['tools', 'workflows', 'list'] as const,
    },
    connectors: {
      list: (type?: string) => ['tools', 'connectors', 'list', type],
      get: (connectorId: string) => ['tools', 'connectors', 'get', connectorId],
      listMcpTools: (connectorId: string) => ['tools', 'connectors', 'listMcpTools', connectorId],
    },
    health: {
      list: () => ['tools', 'health', 'list'] as const,
      byId: (toolId: string) => ['tools', 'health', toolId],
      mcp: () => ['tools', 'health', 'mcp'] as const,
    },
    namespace: {
      validate: (namespace: string, connectorId?: string) =>
        ['tools', 'namespace', 'validate', namespace, connectorId] as const,
    },
  },
  skills: {
    all: ['skills'] as const,
    list: ['skills', 'list'] as const,
    byId: (skillId?: string) => ['skills', skillId],
    byAgent: (agentId?: string) => ['skills', 'byAgent', agentId],
  },
  sml: {
    search: (query: string, skipContent: boolean) =>
      ['sml', 'search', { query, skipContent }] as const,
  },
  plugins: {
    all: ['plugins', 'list'] as const,
    byId: (pluginId?: string) => ['plugins', pluginId],
  },
  connectors: {
    all: ['connectors'] as const,
  },
};
