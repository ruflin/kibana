/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const RUN_QUOTA_GROUPS = ['detection', 'investigation', 'ki_extraction'] as const;

export type RunQuotaGroup = (typeof RUN_QUOTA_GROUPS)[number];

export const MIN_RUN_LIMIT = 0;
export const MAX_RUN_LIMIT = 10_000;
export const MIN_COST_LIMIT_USD = 0;
export const MAX_COST_LIMIT_USD = 1_000_000;
export const DEFAULT_COST_LIMIT_USD = 0;
export const DEFAULT_RUN_QUOTA_TIME_ZONE = 'UTC';

export const DEFAULT_RUN_LIMITS: Readonly<Record<RunQuotaGroup, number>> = {
  detection: 15,
  investigation: 3,
  ki_extraction: 3,
};

export interface RunQuotaSettings {
  enabled: boolean;
  limits: Record<RunQuotaGroup, number>;
  /**
   * Global daily estimated cost cap in USD across all Nightshift scheduled activity, where 0
   * means no cost cap. Only enforced while token usage tracking is enabled.
   */
  costLimitUsd: number;
}

export const DEFAULT_RUN_QUOTA_SETTINGS: Readonly<RunQuotaSettings> = {
  enabled: true,
  limits: DEFAULT_RUN_LIMITS,
  costLimitUsd: DEFAULT_COST_LIMIT_USD,
};

export interface RunQuotaWindow {
  start: string;
  resetsAt: string;
  timezone: typeof DEFAULT_RUN_QUOTA_TIME_ZONE;
}

export interface RunQuotasResponse {
  enabled: boolean;
  limits: Record<RunQuotaGroup, number>;
  costLimitUsd: number;
  counts: Record<RunQuotaGroup, number>;
  window: RunQuotaWindow;
  canManage: boolean;
}

export type RunQuotaSettingsUpdate =
  | {
      enabled?: boolean;
      limits?: Partial<Record<RunQuotaGroup, number>>;
      costLimitUsd?: number;
      activateLimits?: never;
    }
  | {
      /**
       * Atomically enables these categories, normalizing legacy globally disabled settings
       * without overwriting categories activated by a concurrent request.
       */
      activateLimits: Partial<Record<RunQuotaGroup, number>>;
      costLimitUsd?: number;
      enabled?: never;
      limits?: never;
    };

export type RunQuotaConsumeRequest =
  | { group: 'detection' }
  | { group: 'ki_extraction' }
  | { group: 'investigation' };

export interface RunQuotaConsumeResponse {
  allowed: boolean;
}
