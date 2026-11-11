/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';

import { isRight, type Either } from 'fp-ts/Either';
import { esqlRows, runEsqlRead } from '../../../utils/esql_read';
import type { Batch, BulkPrivMonUser, BulkProcessingError } from './types';

export const queryExistingUsers =
  (esClient: ElasticsearchClient, index: string) =>
  async (batch: Array<Either<BulkProcessingError, BulkPrivMonUser>>): Promise<Batch> => {
    const usernames = Array.from(batch)
      .filter(isRight)
      .map((e) => e.right.username);

    // `IN ()` is not valid ES|QL, and a `terms` query on no values matched nothing.
    const response =
      usernames.length > 0
        ? await runEsqlRead({
            esClient,
            query: esql.from([index], ['_id']).where`user.name IN (${{ usernames }})`
              .pipe`KEEP user.name, _id`.limit(batch.length),
          })
        : undefined;

    const existingUsers = esqlRows(response).reduce<Record<string, string>>((users, row) => {
      if (!row['user.name']) {
        throw new Error('User name is missing');
      }
      if (!row._id) {
        throw new Error('User ID is missing');
      }
      users[row['user.name'] as string] = row._id as string;
      return users;
    }, {});

    return { existingUsers, uploaded: batch };
  };
