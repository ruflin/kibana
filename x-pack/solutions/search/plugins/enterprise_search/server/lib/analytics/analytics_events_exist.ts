/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IScopedClusterClient } from '@kbn/core-elasticsearch-server';

import { esqlCount, isEsqlUnknownIndexException } from '../../utils/esql_helpers';
import { isIndexNotFoundException } from '../../utils/identify_exceptions';

export const analyticsEventsExist = async (
  client: IScopedClusterClient,
  datastreamName: string
): Promise<boolean> => {
  try {
    return (await esqlCount(client.asCurrentUser, datastreamName)) > 0;
  } catch (error) {
    if (isIndexNotFoundException(error) || isEsqlUnknownIndexException(error)) {
      return false;
    }
    throw error;
  }
};
