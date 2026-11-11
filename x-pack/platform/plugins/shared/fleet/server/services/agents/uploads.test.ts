/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';

import { AGENT_ACTIONS_INDEX, AGENT_ACTIONS_RESULTS_INDEX } from '../../../common';
import { FILE_STORAGE_METADATA_AGENT_INDEX } from '../../constants';

import { appContextService } from '../app_context';
import { createAppContextStartContractMock } from '../../mocks';

import { deleteAgentUploadFile, getAgentIdForUploadFile, getAgentUploads } from './uploads';
import {
  AGENT_ACTIONS_FIXTURES,
  AGENT_ACTIONS_RESULTS_FIXTURES,
  FILES_METADATA_BY_ACTION_ID,
} from './uploads.test_fixtures';

describe('getAgentUploads', () => {
  const esClient = {} as ElasticsearchClient;

  beforeAll(async () => {
    appContextService.start(createAppContextStartContractMock());
  });

  afterAll(() => {
    appContextService.stop();
  });

  it('should return right list of files', async () => {
    esClient.esql = {
      query: jest.fn().mockImplementation(({ query }: { query: string }) => {
        if (query.startsWith(`FROM ${AGENT_ACTIONS_INDEX} `)) {
          return {
            columns: [
              { name: 'action_id', type: 'keyword' },
              { name: '@timestamp', type: 'date' },
              { name: 'expiration', type: 'date' },
            ],
            values: AGENT_ACTIONS_FIXTURES.map(({ _source }) => [
              _source.action_id,
              _source['@timestamp'],
              _source.expiration,
            ]),
          };
        }
        return {
          columns: [{ name: '_source', type: '_source' }],
          values: AGENT_ACTIONS_RESULTS_FIXTURES.map(({ _source }) => [_source]),
        };
      }),
    } as unknown as ElasticsearchClient['esql'];
    esClient.search = jest.fn().mockImplementation(({ index, query }) => {
      if (index === FILE_STORAGE_METADATA_AGENT_INDEX) {
        const actionId = query.bool.filter.bool.must[1].term.action_id as string;
        if (FILES_METADATA_BY_ACTION_ID[actionId]) {
          return { hits: { hits: [FILES_METADATA_BY_ACTION_ID[actionId]] } };
        } else {
          return { hits: { hits: [] } };
        }
      }
    });

    const response = await getAgentUploads(esClient, 'agent-1');
    expect(response.length).toBe(7);
    expect(response.filter((i) => i.status === 'DELETED').length).toBe(0);
    response.forEach((item) => {
      expect(item.name).toBeDefined();
      if (item.status === 'READY') {
        expect(item.name).toEqual(`${item.id}.zip`);
      } else {
        expect(item.name).toMatch(new RegExp(`^elastic-agent-diagnostics-.*\.zip$`));
      }
    });
    expect(response.map(({ createTime, name, ...rest }) => rest)).toMatchSnapshot();

    const [actionsRequest, resultsRequest] = (esClient.esql.query as jest.Mock).mock.calls.map(
      ([request]) => request
    );
    expect(actionsRequest.query).toBe(
      `FROM ${AGENT_ACTIONS_INDEX} | WHERE type == "REQUEST_DIAGNOSTICS" | SORT @timestamp DESC NULLS LAST | KEEP action_id, @timestamp, expiration | LIMIT 10000`
    );
    // the multi-valued `agents` field is matched by the Query DSL filter
    expect(actionsRequest.filter).toEqual({ term: { agents: 'agent-1' } });
    expect(resultsRequest.query).toContain(`FROM ${AGENT_ACTIONS_RESULTS_INDEX} METADATA _source`);
    expect(resultsRequest.query).toContain('AND agent_id == ?agentId');
  });
});

describe('getAgentIdForUploadFile', () => {
  const esClient = {} as ElasticsearchClient;

  beforeAll(async () => {
    appContextService.start(createAppContextStartContractMock());
  });

  afterAll(() => {
    appContextService.stop();
  });

  it('should return the agent id from file metadata', async () => {
    esClient.esql = {
      query: jest.fn().mockResolvedValueOnce({
        columns: [{ name: 'agent_id', type: 'keyword' }],
        values: [['agent-1']],
      }),
    } as unknown as ElasticsearchClient['esql'];

    const result = await getAgentIdForUploadFile(esClient, 'file-1');

    expect(result).toBe('agent-1');
    expect(esClient.esql.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: `FROM ${FILE_STORAGE_METADATA_AGENT_INDEX} METADATA _id | WHERE _id == ?fileId | KEEP agent_id | LIMIT 1`,
        params: [{ fileId: 'file-1' }],
      })
    );
  });

  it('should throw FleetNotFoundError when file is not found', async () => {
    esClient.esql = {
      query: jest.fn().mockResolvedValueOnce({
        columns: [{ name: 'agent_id', type: 'keyword' }],
        values: [],
      }),
    } as unknown as ElasticsearchClient['esql'];

    await expect(getAgentIdForUploadFile(esClient, 'missing-file')).rejects.toThrow(
      'File missing-file not found'
    );
  });
});

describe('deleteAgentUploadFile', () => {
  const esClient = {} as ElasticsearchClient;
  const id = 'agent-upload-file-id';

  beforeAll(async () => {
    appContextService.start(createAppContextStartContractMock());
  });

  afterAll(() => {
    appContextService.stop();
  });

  describe('should return success', () => {
    it('if the file was deleted and metadata was updated normally', async () => {
      esClient.deleteByQuery = jest.fn().mockResolvedValueOnce({ deleted: 1 });
      esClient.updateByQuery = jest.fn().mockResolvedValueOnce({ total: 1 });
      const response = await deleteAgentUploadFile(esClient, id);
      expect(esClient.deleteByQuery).toHaveBeenCalledTimes(1);
      expect(esClient.updateByQuery).toHaveBeenCalledTimes(1);
      expect(response).toEqual({ id, deleted: true });
    });
    it('if no files needed to be deleted and metadata was updated normally', async () => {
      esClient.deleteByQuery = jest.fn().mockResolvedValueOnce({ total: 0 });
      esClient.updateByQuery = jest.fn().mockResolvedValueOnce({ total: 1 });
      const response = await deleteAgentUploadFile(esClient, id);
      expect(esClient.deleteByQuery).toHaveBeenCalledTimes(1);
      expect(esClient.updateByQuery).toHaveBeenCalledTimes(1);
      expect(response).toEqual({ id, deleted: true });
    });
  });

  describe('should throw an error', () => {
    it('if data file deletion failed due to ES client error', async () => {
      esClient.deleteByQuery = jest.fn().mockRejectedValueOnce(new Error('some es error'));
      esClient.updateByQuery = jest.fn();
      await expect(deleteAgentUploadFile(esClient, id)).rejects.toThrow('some es error');
      expect(esClient.deleteByQuery).toHaveBeenCalledTimes(1);
      expect(esClient.updateByQuery).not.toHaveBeenCalled();
    });
    it('if data file deletion failed due to no files deleted', async () => {
      esClient.deleteByQuery = jest.fn().mockResolvedValueOnce({ deleted: 0, total: 1 });
      esClient.updateByQuery = jest.fn();
      await expect(deleteAgentUploadFile(esClient, id)).rejects.toThrow(
        `Failed to delete file ${id} from file storage data stream`
      );
      expect(esClient.deleteByQuery).toHaveBeenCalledTimes(1);
      expect(esClient.updateByQuery).not.toHaveBeenCalled();
    });
    it('if metadata deletion failed due to ES client error', async () => {
      esClient.deleteByQuery = jest.fn().mockResolvedValueOnce({ total: 0 });
      esClient.updateByQuery = jest.fn().mockRejectedValueOnce(new Error('some es error'));
      await expect(deleteAgentUploadFile(esClient, id)).rejects.toThrow('some es error');
      expect(esClient.deleteByQuery).toHaveBeenCalledTimes(1);
      expect(esClient.updateByQuery).toHaveBeenCalledTimes(1);
    });
    it('if metadata deletion failed due to no files deleted', async () => {
      esClient.deleteByQuery = jest.fn().mockResolvedValueOnce({ total: 0 });
      esClient.updateByQuery = jest.fn().mockResolvedValueOnce({ total: 0 });
      await expect(deleteAgentUploadFile(esClient, id)).rejects.toThrow(
        `Failed to update file ${id} metadata`
      );
      expect(esClient.deleteByQuery).toHaveBeenCalledTimes(1);
      expect(esClient.updateByQuery).toHaveBeenCalledTimes(1);
    });
  });
});
