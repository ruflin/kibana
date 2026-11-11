/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { isCcsTarget } from '../utils/ccs';
import { frozenTierClauses } from '../utils/data_tiers';

// An index name is interpolated into the ES|QL `FROM` command, so only characters that can
// appear in an index name, an index pattern or a remote cluster prefix are accepted.
const INDEX_NAME_PATTERN = /^[\w.\-*:+,]+$/;

export interface GetDocumentByIdSuccess {
  id: string;
  index: string;
  found: true;
  _source: Record<string, unknown>;
}

export interface GetDocumentByIdFailure {
  id: string;
  index: string;
  found: false;
}

export type GetDocumentByIdResult = GetDocumentByIdSuccess | GetDocumentByIdFailure;

export const getDocumentById = async ({
  id,
  index,
  includeFrozen = false,
  esClient,
}: {
  id: string;
  index: string;
  includeFrozen?: boolean;
  esClient: ElasticsearchClient;
}): Promise<GetDocumentByIdResult> => {
  // CCS fallback: the _doc (GET) API does not support cross-cluster index patterns,
  // so we use an ES|QL query on _id instead. The frozen tier exclusion stays a Query DSL
  // request filter, as `_tier` is not a field ES|QL can filter on.
  if (isCcsTarget(index)) {
    if (!INDEX_NAME_PATTERN.test(index)) {
      throw new Error(`Invalid index name or pattern: ${index}`);
    }
    const { query, params } = esql.from(index.split(','), ['_id', '_index', '_source'])
      .pipe`WHERE _id == ${{ id }}`
      .keep('_id', '_index', '_source')
      .limit(1)
      .toRequest();
    const response = (await esClient.esql.query({
      query,
      ...(params ? { params } : {}),
      ...(includeFrozen ? {} : { filter: { bool: { must_not: frozenTierClauses() } } }),
    } as unknown as EsqlQueryRequest)) as unknown as {
      columns: Array<{ name: string }>;
      values: unknown[][];
    };
    const row = response.values?.[0];
    if (!row) {
      return { id, index, found: false };
    }
    const column = (name: string) => row[response.columns.findIndex((c) => c.name === name)];
    const source = column('_source');
    if (source === undefined || source === null) {
      return { id, index, found: false };
    }
    return {
      id: column('_id') as string,
      index: (column('_index') as string | undefined) ?? index,
      found: true,
      _source: source as Record<string, unknown>,
    };
  }

  const { body: response, statusCode } = await esClient.get<Record<string, unknown>>(
    {
      id,
      index,
    },
    { ignore: [404], meta: true }
  );
  if (statusCode === 404) {
    return { id, index, found: false };
  }
  return {
    id,
    index,
    found: true,
    _source: response._source ?? {},
  };
};
