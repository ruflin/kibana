/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import { esqlRows, runEsqlRead, toEsqlSources } from '../../utils/esql_read';

const LOG_DOCUMENT_FIELDS = [
  '@timestamp',
  'message',
  'log.level',
  'service.name',
  'trace.id',
  'span.id',
  'http.response.status_code',
  'error.exception.message',
] as const;

type FieldKeys = (typeof LOG_DOCUMENT_FIELDS)[number];

export type LogDocument = {
  'log.level'?: string;
  '@timestamp'?: string;
  message?: string;
  'http.response.status_code'?: number;
  'error.exception.message'?: string;
} & {
  [K in FieldKeys]?: unknown;
};

export const getLogDocumentById = async ({
  esClient,
  index,
  id,
}: {
  esClient: ElasticsearchClient;
  index: string;
  id: string;
}): Promise<LogDocument | undefined> => {
  // An index (or pattern) that does not exist is an empty result.
  // Every mapped field comes back and the requested ones are picked, because KEEP on a field that
  // is not mapped in the index fails the query.
  const response = await runEsqlRead({
    esClient,
    query: esql.from(toEsqlSources(index), ['_id']).pipe`WHERE _id == ${{ id }}`.limit(1),
  });

  const [row] = esqlRows(response);
  if (!row) {
    return undefined;
  }

  const document = Object.fromEntries(
    LOG_DOCUMENT_FIELDS.flatMap((field) => {
      const value = row[field];
      return value == null ? [] : [[field, value]];
    })
  );

  return Object.keys(document).length > 0 ? (document as LogDocument) : undefined;
};
