/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { SignificantEventsServer } from '../../types';
import { calculateTodayEstimatedCost } from './cost_service';
import type { PriceService } from './price_service';
import { isTokenTrackingEnabled } from './token_tracking_coverage';

export type DailyCostLimitCheck = (limitUsd: number) => Promise<boolean>;

/**
 * Creates a check that reports whether today's estimated Nightshift spend has reached the limit.
 * The limit only applies while token tracking is enabled in the request's space. When the spend
 * cannot be determined the check fails open, because the run count limits still apply.
 */
export const createDailyCostLimitCheck = ({
  request,
  server,
  priceService,
}: {
  request: KibanaRequest;
  server: SignificantEventsServer;
  priceService: PriceService;
}): DailyCostLimitCheck => {
  const logger = server.logger.get('cost');

  return async (limitUsd) => {
    try {
      if (!(await isTokenTrackingEnabled({ request, server }))) {
        return false;
      }

      const priceResult = await priceService.getPrices();
      if (priceResult === null) {
        logger.warn('Daily cost limit not enforced: model prices are unavailable');
        return false;
      }

      const spendUsd = await calculateTodayEstimatedCost({
        esClient: server.core.elasticsearch.client.asInternalUser,
        prices: priceResult.prices,
        now: new Date(),
        logger,
      });
      if (spendUsd === null) {
        logger.warn('Daily cost limit not enforced: today token usage could not be priced');
        return false;
      }

      const reached = spendUsd >= limitUsd;
      if (reached) {
        logger.info(
          `Daily cost limit reached: estimated spend $${spendUsd.toFixed(2)} of $${limitUsd.toFixed(
            2
          )}`
        );
      }
      return reached;
    } catch (error) {
      logger.warn(
        `Daily cost limit not enforced: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  };
};
