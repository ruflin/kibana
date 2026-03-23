/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { expect } from '@kbn/scout/api';
import { tags } from '@kbn/scout';
import { v4 as uuidv4 } from 'uuid';
import { streamsApiTest as apiTest } from '../fixtures';
import { PUBLIC_API_HEADERS } from '../fixtures/constants';
import { queryStorageSettings } from '../../../../server/lib/streams/assets/storage_settings';
import { getQueryLinkUuid } from '../../../../server/lib/streams/assets/query/query_client';

const TOOL_ID = 'platform.streams.sig_events.write_query_knowledge_indicator';

apiTest.describe(
  'write_query_knowledge_indicator tool',
  { tag: [...tags.stateful.classic, ...tags.serverless.observability.complete] },
  () => {
    const rootStream = 'logs.otel';
    const streamName = `${rootStream}.wqki_${uuidv4().slice(0, 8)}`;
    const queryId = `q-${uuidv4()}`;

    apiTest.beforeAll(async ({ apiServices }) => {
      await apiServices.streamsTest.enable();
      await apiServices.streamsTest.enableSignificantEvents();

      await apiServices.streamsTest.forkStream(rootStream, streamName, {
        field: 'service.name',
        eq: `wqki-tool-${streamName}`,
      });
    });

    apiTest.afterAll(async ({ apiServices, esClient }) => {
      await apiServices.streamsTest.cleanupTestStreams(streamName);
      await apiServices.streamsTest.disableSignificantEvents();

      const assetUuid = getQueryLinkUuid(streamName, {
        'asset.type': 'query',
        'asset.id': queryId,
      });

      await esClient.deleteByQuery({
        index: queryStorageSettings.name,
        query: { term: { 'asset.uuid': assetUuid } },
        refresh: true,
      });
    });

    apiTest(
      'writes a query knowledge indicator and returns acknowledged: true',
      async ({ apiClient, samlAuth }) => {
        const { cookieHeader } = await samlAuth.asStreamsAdmin();

        const res = await apiClient.post('api/agent_builder/tools/_execute', {
          headers: { ...PUBLIC_API_HEADERS, ...cookieHeader },
          body: {
            tool_id: TOOL_ID,
            tool_params: {
              stream_name: streamName,
              query_id: queryId,
              title: 'Test query KI',
              description: 'A query written by the agent tool test',
              esql: {
                query: `FROM ${streamName}, ${streamName}.* METADATA _id, _source | LIMIT 10`,
              },
              severity_score: 70,
            },
          },
          responseType: 'json',
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.results).toHaveLength(1);
        expect(res.body.results[0].type).toBe('other');

        const output = res.body.results[0].data as { acknowledged: boolean };
        expect(output.acknowledged).toBe(true);
      }
    );

    apiTest(
      'returns an error result for an invalid ES|QL query',
      async ({ apiClient, samlAuth }) => {
        const { cookieHeader } = await samlAuth.asStreamsAdmin();

        const res = await apiClient.post('api/agent_builder/tools/_execute', {
          headers: { ...PUBLIC_API_HEADERS, ...cookieHeader },
          body: {
            tool_id: TOOL_ID,
            tool_params: {
              stream_name: streamName,
              query_id: `q-invalid-${uuidv4().slice(0, 8)}`,
              title: 'Invalid query',
              description: '',
              esql: {
                query: 'FROM wrong.index METADATA _id, _source | LIMIT 10',
              },
            },
          },
          responseType: 'json',
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.results).toHaveLength(1);
        expect(res.body.results[0].type).toBe('error');
        expect((res.body.results[0].data as { message: string }).message).toContain(
          'Failed to write query knowledge indicator'
        );
      }
    );

    apiTest(
      'returns an error result when Significant Events is disabled',
      async ({ apiClient, samlAuth, apiServices }) => {
        const { cookieHeader } = await samlAuth.asStreamsAdmin();

        await apiServices.streamsTest.disableSignificantEvents();

        try {
          const res = await apiClient.post('api/agent_builder/tools/_execute', {
            headers: { ...PUBLIC_API_HEADERS, ...cookieHeader },
            body: {
              tool_id: TOOL_ID,
              tool_params: {
                stream_name: streamName,
                query_id: `q-disabled-${uuidv4().slice(0, 8)}`,
                title: 'Should fail',
                description: '',
                esql: {
                  query: `FROM ${streamName}, ${streamName}.* METADATA _id, _source | LIMIT 10`,
                },
              },
            },
            responseType: 'json',
          });

          expect(res.statusCode).toBe(200);
          expect(res.body.results).toHaveLength(1);
          expect(res.body.results[0].type).toBe('error');
          expect((res.body.results[0].data as { message: string }).message).toContain(
            'Significant events is disabled'
          );
        } finally {
          await apiServices.streamsTest.enableSignificantEvents();
        }
      }
    );
  }
);
