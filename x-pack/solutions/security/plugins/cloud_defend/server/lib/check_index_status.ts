/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import { type Logger } from '@kbn/core/server';
import type { IndexStatus } from '../../common';

export const checkIndexStatus = async (
  esClient: ElasticsearchClient,
  index: string,
  logger: Logger
): Promise<IndexStatus> => {
  try {
    const queryResult = await esClient.esql.query({
      query: esql.from([index]).limit(1).print('basic'),
    });

    return queryResult.values.length ? 'not-empty' : 'empty';
  } catch (e) {
    logger.debug(e);
    if (e?.meta?.body?.error?.type === 'security_exception') {
      logger.info(e);
      return 'unprivileged';
    }

    // Assuming index doesn't exist
    return 'empty';
  }
};
