/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MAX_COST_LIMIT_USD } from '@kbn/significant-events-plugin/common';

export { MAX_COST_LIMIT_USD };

export type CostLimitDraft = number | '';

/** A cost limit of 0 means the daily cost cap is off. */
export const NO_COST_LIMIT = 0;
export const MIN_ENABLED_COST_LIMIT_USD = 0.01;
export const DEFAULT_ENABLED_COST_LIMIT_USD = 10;

export const parseCostLimitDraft = (value: string): CostLimitDraft =>
  value === '' ? '' : Number(value);

export const isValidEnabledCostLimitDraft = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= MIN_ENABLED_COST_LIMIT_USD &&
  value <= MAX_COST_LIMIT_USD;

export const isValidCostLimitDraft = (value: unknown): value is number =>
  value === NO_COST_LIMIT || isValidEnabledCostLimitDraft(value);
