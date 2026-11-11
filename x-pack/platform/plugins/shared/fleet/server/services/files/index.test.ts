/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClientMock } from '@kbn/core/server/mocks';
import { elasticsearchServiceMock } from '@kbn/core/server/mocks';

import {
  FILE_STORAGE_DATA_INDEX_PATTERN,
  FILE_STORAGE_METADATA_INDEX_PATTERN,
  FILE_STORAGE_TO_HOST_DATA_INDEX_PATTERN,
  FILE_STORAGE_TO_HOST_METADATA_INDEX_PATTERN,
} from '../../../common/constants/file_storage';

import { getFileDataIndexName, getFileMetadataIndexName } from '../../../common/services';

import { ES_SEARCH_LIMIT } from '../../../common/constants';

import { fileIdsWithoutChunksByIndex, getFilesByStatus, updateFilesStatus } from '.';

const ENDPOINT_FILE_METADATA_INDEX = getFileMetadataIndexName('endpoint');
const ENDPOINT_FILE_METADATA_BACKING_INDEX = `${ENDPOINT_FILE_METADATA_INDEX}-000001`;

const ENDPOINT_FILE_INDEX = getFileDataIndexName('endpoint');
const ENDPOINT_FILE_BACKING_INDEX = `${ENDPOINT_FILE_INDEX}-000001`;

describe('files service', () => {
  let esClientMock: ElasticsearchClientMock;
  const { signal } = new AbortController();

  beforeEach(() => {
    esClientMock = elasticsearchServiceMock.createElasticsearchClient();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('#getFilesByStatus()', () => {
    it('should return expected values', async () => {
      const status = 'READY';
      esClientMock.esql.query.mockResolvedValueOnce({
        columns: [
          { name: '_id', type: 'keyword' },
          { name: '_index', type: 'keyword' },
        ],
        values: [
          ['someid1', ENDPOINT_FILE_METADATA_BACKING_INDEX],
          ['someid2', ENDPOINT_FILE_METADATA_BACKING_INDEX],
        ],
      });

      const result = await getFilesByStatus(esClientMock, signal, status);

      expect(esClientMock.esql.query).toHaveBeenCalledWith(
        {
          query: `FROM ${FILE_STORAGE_METADATA_INDEX_PATTERN}, ${FILE_STORAGE_TO_HOST_METADATA_INDEX_PATTERN} METADATA _id, _index | WHERE file.Status == ?status | KEEP _id, _index | LIMIT ${ES_SEARCH_LIMIT}`,
          params: [{ status }],
        },
        { signal }
      );
      expect(result).toEqual([
        { _index: ENDPOINT_FILE_METADATA_BACKING_INDEX, _id: 'someid1' },
        { _index: ENDPOINT_FILE_METADATA_BACKING_INDEX, _id: 'someid2' },
      ]);
    });
  });

  describe('#fileIdsWithoutChunks()', () => {
    it('should return expected values', async () => {
      esClientMock.esql.query.mockResolvedValueOnce({
        columns: [
          { name: 'bid', type: 'keyword' },
          { name: '_index', type: 'keyword' },
        ],
        values: [
          ['keep1', ENDPOINT_FILE_BACKING_INDEX],
          ['keep2', ENDPOINT_FILE_BACKING_INDEX],
        ],
      });

      const files = [
        { _index: ENDPOINT_FILE_METADATA_BACKING_INDEX, _id: 'keep1' },
        { _index: ENDPOINT_FILE_METADATA_BACKING_INDEX, _id: 'keep2' },
        { _index: ENDPOINT_FILE_METADATA_BACKING_INDEX, _id: 'delete1' },
        { _index: ENDPOINT_FILE_METADATA_BACKING_INDEX, _id: 'delete2' },
      ];
      const { fileIdsByIndex: deletedFileIdsByIndex, allFileIds: allDeletedFileIds } =
        await fileIdsWithoutChunksByIndex(esClientMock, signal, files);

      expect(esClientMock.esql.query).toHaveBeenCalledWith(
        {
          query: `FROM ${FILE_STORAGE_DATA_INDEX_PATTERN}, ${FILE_STORAGE_TO_HOST_DATA_INDEX_PATTERN} METADATA _index | WHERE (bid IN (?fileIds)) AND \`last\` == TRUE | KEEP bid, _index | LIMIT ${ES_SEARCH_LIMIT}`,
          params: [{ fileIds: files.map((file) => file._id) }],
        },
        { signal }
      );
      expect(deletedFileIdsByIndex).toEqual({
        [ENDPOINT_FILE_METADATA_INDEX]: new Set(['delete1', 'delete2']),
      });
      expect(allDeletedFileIds).toEqual(new Set(['delete1', 'delete2']));
    });
  });

  describe('#updateFilesStatus()', () => {
    it('calls esClient.updateByQuery with expected values', async () => {
      const FAKE_INTEGRATION_METADATA_INDEX = getFileMetadataIndexName('someintegration');
      const files = {
        [ENDPOINT_FILE_METADATA_INDEX]: new Set(['delete1', 'delete2']),
        [FAKE_INTEGRATION_METADATA_INDEX]: new Set(['delete2', 'delete3']),
      };
      const status = 'DELETED';
      await updateFilesStatus(esClientMock, signal, files, status);

      expect(esClientMock.updateByQuery).toHaveBeenNthCalledWith(
        1,
        {
          index: ENDPOINT_FILE_METADATA_INDEX,
          refresh: true,
          query: {
            ids: {
              values: Array.from(files[ENDPOINT_FILE_METADATA_INDEX]),
            },
          },
          script: {
            source: `ctx._source.file.Status = '${status}'`,
            lang: 'painless',
          },
        },
        { signal }
      );
      expect(esClientMock.updateByQuery).toHaveBeenNthCalledWith(
        2,
        {
          index: FAKE_INTEGRATION_METADATA_INDEX,
          refresh: true,
          query: {
            ids: {
              values: Array.from(files[FAKE_INTEGRATION_METADATA_INDEX]),
            },
          },
          script: {
            source: `ctx._source.file.Status = '${status}'`,
            lang: 'painless',
          },
        },
        { signal }
      );
    });
  });
});
