/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { Streams } from '@kbn/streams-schema';
import { mapSourceRows } from '../helpers/esql';
import type { StreamsStorageClient } from './streams_storage_client';

/** The most definitions a read returns: the old `index.max_result_window` from + size limit. */
export const MAX_STREAM_DEFINITIONS = 10_000;

/**
 * Reads every stored stream definition, ordered by name. The storage client's ES|QL method applies
 * `migrateOnRead` to each `_source` and returns no rows when the index does not exist yet.
 */
export async function readStreamDefinitions(
  storageClient: StreamsStorageClient
): Promise<Streams.all.Definition[]> {
  const response = await storageClient.esql({
    metadata: ['_source'],
    pipeline: esql`SORT name ASC NULLS LAST | LIMIT ${MAX_STREAM_DEFINITIONS}`,
  });

  return mapSourceRows<Streams.all.Definition, Streams.all.Definition>(
    response,
    (definition) => definition
  );
}
