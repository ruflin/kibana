/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IScopedClusterClient } from '@kbn/core/server';

import { esqlCount } from '../../utils/esql_helpers';

export const fetchIndexCounts = async (client: IScopedClusterClient, indicesNames: string[]) => {
  // One count per index, so that an index that breaks (missing, closed) only zeroes its own count.
  const countPromises = indicesNames.map(async (indexName) => {
    try {
      return { [indexName]: await esqlCount(client.asCurrentUser, indexName) };
    } catch {
      // we don't want to error out the whole API call if one index breaks (eg: doesn't exist or is closed)
      return { [indexName]: 0 };
    }
  });
  const indexCountArray = await Promise.all(countPromises);
  return indexCountArray.reduce((acc, current) => Object.assign(acc, current), {});
};
