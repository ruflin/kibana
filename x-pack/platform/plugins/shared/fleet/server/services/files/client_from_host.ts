/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Readable } from 'stream';

import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import type { Logger } from '@kbn/core/server';
import type { estypes } from '@elastic/elasticsearch';

import type { FileClient } from '@kbn/files-plugin/server';
import { createEsFileClient } from '@kbn/files-plugin/server';
import type { File } from '@kbn/files-plugin/common';

import moment from 'moment';
import { esql } from '@elastic/esql';

import { FleetFileNotFound, FleetFilesClientError } from '../../errors';
import { esqlRows, isEsqlUnknownIndexError, runEsqlRead } from '../esql_read';

import type {
  FileCustomMeta,
  FleetFile,
  FleetFromHostFileClientInterface,
  HostUploadedFileMetadata,
} from './types';

/**
 * Public interface for interacting with Files stored in Fleet indexes. Service is consumed via
 * the Fleet `Plugin#start()` interface - {@link FleetStartContract}
 */
export class FleetFromHostFilesClient implements FleetFromHostFileClientInterface {
  protected esFileClient: FileClient;

  constructor(
    protected esClient: ElasticsearchClient,
    protected logger: Logger,
    protected fileMetaIndex: string,
    protected fileDataIndex: string,
    maxSizeBytes?: number
  ) {
    this.esFileClient = createEsFileClient({
      metadataIndex: this.fileMetaIndex,
      blobStorageIndex: this.fileDataIndex,
      elasticsearchClient: esClient,
      logger,
      indexIsAlias: true,
      maxSizeBytes,
    });
  }

  async get(fileId: string): Promise<FleetFile> {
    try {
      const fileDocSearchResult = await runEsqlRead({
        esClient: this.esClient,
        query: esql.from([this.fileMetaIndex], ['_id', '_index', '_source']).where`_id == ${{
          fileId,
        }}`
          .keep('_id', '_index', '_source')
          .limit(1),
      });

      const [fileDocRow] = esqlRows(fileDocSearchResult);
      const docSearchHit = {
        _id: fileDocRow?._id as string | undefined,
        _index: fileDocRow?._index as string | undefined,
        _source: fileDocRow?._source as HostUploadedFileMetadata | undefined,
      } as estypes.SearchHit<HostUploadedFileMetadata>;

      if (!docSearchHit._source) {
        throw new FleetFileNotFound(
          `File with id [${fileId}] not found in index [${this.fileMetaIndex}]`,
          fileDocSearchResult
        );
      }

      const fleetFile = this.mapIndexedDocToFleetFile(docSearchHit);
      await this.adjustFileStatusIfNeeded(fleetFile);

      return fleetFile;
    } catch (error) {
      if (error instanceof FleetFilesClientError) {
        throw error;
      }
      if (error.message.includes('index_not_found') || isEsqlUnknownIndexError(error)) {
        throw new FleetFileNotFound(error.message, error);
      }

      throw new FleetFilesClientError(error.message, error);
    }
  }

  async doesFileHaveData(fileId: string): Promise<boolean> {
    try {
      const chunks = await runEsqlRead({
        esClient: this.esClient,
        // Only the existence of a chunk matters, not the actual document
        query: esql.from([this.fileDataIndex]).where`bid == ${{ fileId }}`.keep('bid').limit(1),
      });

      return esqlRows(chunks).length > 0;
    } catch (err) {
      throw new FleetFilesClientError(
        `Checking if file id [${fileId}] has data in index [${this.fileDataIndex}] failed with: ${err.message}`,
        err
      );
    }
  }

  async download(
    fileId: string
  ): Promise<{ stream: Readable; fileName: string; mimeType?: string }> {
    try {
      const file = await this.esFileClient.get({ id: fileId });
      const { name: fileName, mimeType } = file.data;

      return {
        stream: await file.downloadContent(),
        fileName,
        mimeType,
      };
    } catch (error) {
      throw new FleetFilesClientError(
        `Attempt to get download stream failed with: ${error.message}`,
        error
      );
    }
  }

  /**
   * Will check if the file actually has data (chunks) if the `status` is `READY`, and if not, it
   * will set (mutate) the `status` to `DELETED`.
   * Covers edge case where ILM could have deleted the file data, but the background task has not
   * yet adjusted the file's meta to reflect that state.
   * @param file
   * @protected
   */
  protected async adjustFileStatusIfNeeded(file: FleetFile): Promise<void> {
    // if status is `READY` and file is older than 5 minutes, then ensure that file has
    // chunks
    if (file.status === 'READY' && moment().diff(file.created, 'minutes') >= 10) {
      const fileHasChunks: boolean = await this.doesFileHaveData(file.id);

      if (!fileHasChunks) {
        this.logger.warn(
          `File with id [${file.id}] has no data chunks in index [${this.fileDataIndex}]. File status will be adjusted to DELETED`
        );

        file.status = 'DELETED';
      }
    }
  }

  protected mapIndexedDocToFleetFile(
    fileDoc: estypes.SearchHit<HostUploadedFileMetadata> | File<FileCustomMeta>
  ): FleetFile {
    if (isSearchHit(fileDoc)) {
      if (!fileDoc._source) {
        throw new FleetFilesClientError('Missing file document `_source`');
      }

      const {
        action_id: actionId,
        agent_id: agentId,
        upload_start: created,
        file: { name, Status: status, mime_type: mimeType = '', size = 0, hash = {} },
      } = fileDoc._source;

      const file: FleetFile = {
        id: fileDoc._id!,
        agents: [agentId],
        sha256: hash?.sha256 ?? '',
        created: new Date(created).toISOString(),
        actionId,
        name,
        status,
        mimeType,
        size,
      };

      return file;
    } else {
      const { name, meta, id, mimeType = '', size = 0, status, hash, created } = fileDoc.toJSON();

      const file: FleetFile = {
        id,
        agents: meta?.target_agents ?? [],
        sha256: hash?.sha256 ?? '',
        actionId: meta?.action_id ?? '',
        name,
        status,
        mimeType,
        size,
        created,
      };

      return file;
    }
  }
}

const isSearchHit = (data: unknown): data is estypes.SearchHit<HostUploadedFileMetadata> => {
  return (
    data !== undefined &&
    data !== null &&
    typeof data === 'object' &&
    '_source' in data &&
    '_id' in data &&
    '_index' in data
  );
};
