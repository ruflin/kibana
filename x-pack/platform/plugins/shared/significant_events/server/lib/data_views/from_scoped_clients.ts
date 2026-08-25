/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { RouteHandlerScopedClients } from '../../routes/types';
import { createDataViewsService, type DataViewsService } from './data_views_service';

export const createDataViewsServiceFromClients = async ({
  scopedClients,
  logger,
}: {
  scopedClients: RouteHandlerScopedClients;
  logger: Logger;
}): Promise<DataViewsService> => {
  const { alertingV2RulesClient } = await scopedClients.getSignificantEventsAlertingContext();
  return createDataViewsService({
    soClient: scopedClients.soClient,
    esClient: scopedClients.streamDataEsClient,
    logger,
    alertingV2RulesClient,
  });
};
