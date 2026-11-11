/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { UptimeEsClient } from '../lib';
import { isEsqlUnknownIndexError } from '../esql_read';
import type { StatesIndexStatus } from '../../../../common/runtime_types';

export const getIndexStatus = async ({
  uptimeEsClient,
  range,
}: {
  uptimeEsClient: UptimeEsClient;
  range?: { to: string; from: string };
}): Promise<StatesIndexStatus> => {
  const { to, from } = range || {};
  try {
    // Only existence matters (the DSL count used `terminate_after: 1`), so one row is enough. The
    // range may use date math, so it stays in the Query DSL filter.
    const { response, indices } = await uptimeEsClient.esql(
      (indexList) => esql.from(indexList).limit(1),
      {
        operationName: 'getIndexStatus',
        throwOnUnknownIndex: true,
        ...(to && from ? { filter: { range: { '@timestamp': { gte: from, lte: to } } } } : {}),
      }
    );
    const count = response.values.length;
    return {
      indices,
      indexExists: count > 0,
    };
  } catch (e) {
    if (e.meta?.statusCode === 404 || isEsqlUnknownIndexError(e)) {
      // we don't throw an error for index not found
      return {
        indices: '',
        indexExists: false,
      };
    }
    throw e;
  }
};
