/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export type { PaginatedResponse } from '../../../common/pagination';

export interface BulkCreateOptions {
  throwOnFail?: boolean;
  /**
   * Elasticsearch bulk `refresh` param. Defaults to `false` (no refresh). Pass `'wait_for'` when
   * the caller needs a subsequent read to see this write (e.g. a manual, user-triggered update
   * that immediately re-fetches).
   */
  refresh?: 'wait_for' | boolean;
}

export interface CommonSearchOptions {
  /** ISO 8601 formatted datetime */
  from?: string;
  /** ISO 8601 formatted datetime */
  to?: string;
}

export interface PaginatedSearchOptions extends CommonSearchOptions {
  page?: number;
  perPage?: number;
}

/**
 * Maximum number of distinct active events returned by `findLatestActive`. With `sourceIds` + `ruleUuids`
 * narrowing the result is proportional to the write batch size, so this cap is a safety bound
 * rather than an operational limit. Shared by `EventClient` and `RuleEventsClient`.
 */
export const MAX_DEDUP_SCAN_LIMIT = 500;
