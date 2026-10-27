/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import { loggerMock } from '@kbn/logging-mocks';
import type { SignificantEventsServer } from '../../types';
import { calculateTodayEstimatedCost } from './cost_service';
import { createDailyCostLimitCheck } from './daily_cost_limit';
import type { PriceResult, PriceService } from './price_service';
import { isTokenTrackingEnabled } from './token_tracking_coverage';

jest.mock('./cost_service', () => ({ calculateTodayEstimatedCost: jest.fn() }));
jest.mock('./token_tracking_coverage', () => ({ isTokenTrackingEnabled: jest.fn() }));

const logger = loggerMock.create();
const request = {} as KibanaRequest;
const esClient = {};
const server = {
  logger: { get: jest.fn().mockReturnValue(logger) },
  core: { elasticsearch: { client: { asInternalUser: esClient } } },
} as unknown as SignificantEventsServer;
const priceResult: PriceResult = { prices: new Map(), fetchedAt: '2026-09-09', stale: false };
const getPrices = jest.fn();
const priceService: PriceService = { getPrices };

const createCheck = () => createDailyCostLimitCheck({ request, server, priceService });

describe('createDailyCostLimitCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(isTokenTrackingEnabled).mockResolvedValue(true);
    getPrices.mockResolvedValue(priceResult);
    jest.mocked(calculateTodayEstimatedCost).mockResolvedValue(1);
  });

  it('reports the limit as reached when today spend equals or exceeds it', async () => {
    jest.mocked(calculateTodayEstimatedCost).mockResolvedValue(5);

    await expect(createCheck()(5)).resolves.toBe(true);
    expect(calculateTodayEstimatedCost).toHaveBeenCalledWith(
      expect.objectContaining({ esClient, prices: priceResult.prices })
    );
  });

  it('reports the limit as not reached when today spend is below it', async () => {
    jest.mocked(calculateTodayEstimatedCost).mockResolvedValue(4.99);

    await expect(createCheck()(5)).resolves.toBe(false);
  });

  it('does not enforce the limit and skips the cost query when token tracking is disabled', async () => {
    jest.mocked(isTokenTrackingEnabled).mockResolvedValue(false);
    jest.mocked(calculateTodayEstimatedCost).mockResolvedValue(100);

    await expect(createCheck()(5)).resolves.toBe(false);
    expect(getPrices).not.toHaveBeenCalled();
    expect(calculateTodayEstimatedCost).not.toHaveBeenCalled();
  });

  it('fails open when prices are unavailable', async () => {
    getPrices.mockResolvedValue(null);

    await expect(createCheck()(5)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('prices are unavailable'));
  });

  it('fails open when spend cannot be priced', async () => {
    jest.mocked(calculateTodayEstimatedCost).mockResolvedValue(null);

    await expect(createCheck()(5)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not be priced'));
  });

  it('fails open when reading the token usage fails', async () => {
    jest.mocked(calculateTodayEstimatedCost).mockRejectedValue(new Error('search failed'));

    await expect(createCheck()(5)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('search failed'));
  });
});
