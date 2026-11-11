/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { fetchConnectorByIndexName } from '@kbn/search-connectors';
import type { FetchIndexResult } from '../../../common/types';

// Index names the ES|QL parser reads without quotes. Anything else is quoted, so that an index
// name can never end the `FROM` command.
const UNQUOTED_SOURCE = /^[A-Za-z0-9._*:-]+$/;

const toEsqlSource = (source: string): string =>
  UNQUOTED_SOURCE.test(source) ? source : `"${source.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const countDocuments = async (client: ElasticsearchClient, indexName: string): Promise<number> => {
  const { query } = esql.from([toEsqlSource(indexName)]).pipe`STATS total = COUNT(*)`.toRequest();
  const response = (await client.esql.query({ query })) as unknown as { values: unknown[][] };
  const total = response.values[0]?.[0];
  return typeof total === 'number' ? total : 0;
};

export async function fetchIndex(
  client: ElasticsearchClient,
  indexName: string
): Promise<FetchIndexResult | undefined> {
  const [indexDataResult, indexCountResult, connectorResult] = await Promise.allSettled([
    client.indices.get({ index: indexName }),
    countDocuments(client, indexName),
    fetchConnectorByIndexName(client, indexName),
  ]);

  if (indexDataResult.status === 'rejected') {
    throw indexDataResult.reason;
  }
  const indexData = indexDataResult.value;
  if (!indexData || !indexData[indexName]) return undefined;

  const index = indexData[indexName];
  const count = indexCountResult.status === 'fulfilled' ? indexCountResult.value : 0;
  const connector = connectorResult.status === 'fulfilled' ? connectorResult.value : undefined;
  return {
    index: {
      ...index,
      count,
      connector,
    },
  };
}
