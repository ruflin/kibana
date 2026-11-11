/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '../elasticsearch_client';

// Index names the ES|QL parser reads without quotes. Anything else is quoted, so that an index
// name can never end the `FROM` command.
const UNQUOTED_SOURCE = /^[A-Za-z0-9._*:-]+$/;

const toEsqlSource = (source: string): string =>
  UNQUOTED_SOURCE.test(source) ? source : `"${source.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Retrieves the count of documents in a given index
 *
 * @param esClient An {@link ElasticsearchClient}
 * @param index index whose documents will be counted
 *
 * @returns the document count
 */
export const getIndexCount = async ({
  esClient,
  index,
}: {
  esClient: ElasticsearchClient;
  index: string;
}): Promise<number> => {
  const sources = index.split(',').map((source) => toEsqlSource(source.trim()));
  const { query } = esql.from(sources).pipe`STATS total = COUNT(*)`.toRequest();
  const response = (await esClient.esql.query({ query })) as unknown as { values: unknown[][] };
  const total = response.values[0]?.[0];

  return typeof total === 'number' ? total : 0;
};
