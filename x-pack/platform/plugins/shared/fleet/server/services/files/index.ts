/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { SearchHit, UpdateByQueryResponse } from '@elastic/elasticsearch/lib/api/types';
import type { FileStatus } from '@kbn/files-plugin/common/types';
import pMap from 'p-map';
import { esql } from '@elastic/esql';

import {
  FILE_STORAGE_DATA_INDEX_PATTERN,
  FILE_STORAGE_METADATA_INDEX_PATTERN,
  FILE_STORAGE_TO_HOST_DATA_INDEX_PATTERN,
  FILE_STORAGE_TO_HOST_METADATA_INDEX_PATTERN,
} from '../../../common/constants';

import { getFileMetadataIndexName } from '../../../common/services';

import { ES_SEARCH_LIMIT } from '../../../common/constants';

import { MAX_CONCURRENT_AGENT_FILES_UPLOADS } from '../../constants';

import { esqlRows, runEsqlRead } from '../esql_read';

import { parseFileStorageIndex } from './utils';

/**
 * Gets files with given status from the files metadata index. Includes both files
 * `tohost` and files `fromhost`
 *
 * @param esClient
 * @param signal
 * @param status
 */
export async function getFilesByStatus(
  esClient: ElasticsearchClient,
  signal: AbortSignal,
  status: FileStatus = 'READY'
): Promise<SearchHit[]> {
  const result = await runEsqlRead({
    esClient,
    query: esql.from(
      [FILE_STORAGE_METADATA_INDEX_PATTERN, FILE_STORAGE_TO_HOST_METADATA_INDEX_PATTERN],
      ['_id', '_index']
    ).where`file.Status == ${{ status }}`
      .keep('_id', '_index')
      .limit(ES_SEARCH_LIMIT),
    // No file indices yet means no files, as the DSL `ignore_unavailable` did.
    ignoreUnknownIndex: true,
    signal,
  }).catch((err) => {
    Error.captureStackTrace(err);
    throw err;
  });

  return esqlRows(result).map((row) => ({ _id: row._id as string, _index: row._index as string }));
}

interface FileIdsByIndex {
  [index: string]: Set<string>;
}

/**
 * Returns subset of fileIds that don't have any file chunks
 *
 * @param esClient
 * @param signal
 * @param files
 */
export async function fileIdsWithoutChunksByIndex(
  esClient: ElasticsearchClient,
  signal: AbortSignal,
  files: SearchHit[]
): Promise<{ fileIdsByIndex: FileIdsByIndex; allFileIds: Set<string> }> {
  const allFileIds: Set<string> = new Set();
  const noChunkFileIdsByIndex = files.reduce((acc, file) => {
    allFileIds.add(file._id!);

    const { index: metadataIndex } = parseFileStorageIndex(file._index);
    const fileIds = acc[metadataIndex];

    acc[metadataIndex] = fileIds ? fileIds.add(file._id!) : new Set([file._id!]);

    return acc;
  }, {} as FileIdsByIndex);

  const chunks = await runEsqlRead({
    esClient,
    query: esql.from(
      [FILE_STORAGE_DATA_INDEX_PATTERN, FILE_STORAGE_TO_HOST_DATA_INDEX_PATTERN],
      ['_index']
    ).where`bid IN (${{ fileIds: Array.from(allFileIds) }}) AND \`last\` == TRUE`
      .keep('bid', '_index')
      .limit(ES_SEARCH_LIMIT),
    ignoreUnknownIndex: true,
    signal,
  }).catch((err) => {
    Error.captureStackTrace(err);
    throw err;
  });

  esqlRows(chunks).forEach((row) => {
    const fileId = row.bid as string | null;

    if (!fileId) return;

    const { integration, direction } = parseFileStorageIndex(row._index as string);
    const metadataIndex = getFileMetadataIndexName(integration, direction === 'to-host');

    if (noChunkFileIdsByIndex[metadataIndex]?.delete(fileId)) {
      allFileIds.delete(fileId);
    }
  });

  return { fileIdsByIndex: noChunkFileIdsByIndex, allFileIds };
}

/**
 * Updates given files to provided status
 *
 * @param esClient
 * @param signal
 * @param fileIdsByIndex
 * @param status
 */
export async function updateFilesStatus(
  esClient: ElasticsearchClient,
  signal: AbortSignal | undefined,
  fileIdsByIndex: FileIdsByIndex,
  status: FileStatus
): Promise<UpdateByQueryResponse[]> {
  return await pMap(
    Object.entries(fileIdsByIndex),
    ([index, fileIds]) => {
      return esClient
        .updateByQuery(
          {
            index,
            refresh: true,
            query: {
              ids: {
                values: Array.from(fileIds),
              },
            },
            script: {
              source: `ctx._source.file.Status = '${status}'`,
              lang: 'painless',
            },
          },
          signal ? { signal } : {}
        )
        .catch((err) => {
          Error.captureStackTrace(err);
          throw err;
        });
    },
    {
      concurrency: MAX_CONCURRENT_AGENT_FILES_UPLOADS,
    }
  );
}
