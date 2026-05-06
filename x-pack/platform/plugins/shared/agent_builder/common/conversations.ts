/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Conversation } from '@kbn/agent-builder-common';

export type ConversationCreateRequest = Omit<
  Conversation,
  'id' | 'created_at' | 'updated_at' | 'user'
> & {
  id?: string;
};

export interface ConversationListOptions {
  agentId?: string;
  /**
   * When true, hidden conversations are included in the list. Defaults to
   * false. Hidden conversations remain accessible by ID regardless of this
   * flag.
   */
  includeHidden?: boolean;
}

export interface ConversationGetOptions {
  conversationId: string;
}

export interface ConversationDeleteOptions {
  conversationId: string;
}
