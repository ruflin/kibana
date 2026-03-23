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
import { featureStorageSettings } from '../../../../server/lib/streams/feature/storage_settings';

const TOOL_ID = 'platform.streams.sig_events.write_feature_knowledge_indicator';

apiTest.describe(
  'write_feature_knowledge_indicator tool',
  { tag: [...tags.stateful.classic, ...tags.serverless.observability.complete] },
  () => {
    const rootStream = 'logs.otel';
    const streamName = `${rootStream}.wfki_${uuidv4().slice(0, 8)}`;

    apiTest.beforeAll(async ({ apiServices }) => {
      await apiServices.streamsTest.enable();
      await apiServices.streamsTest.enableSignificantEvents();

      await apiServices.streamsTest.forkStream(rootStream, streamName, {
        field: 'service.name',
        eq: `wfki-tool-${streamName}`,
      });
    });

    apiTest.afterAll(async ({ apiServices, esClient }) => {
      await apiServices.streamsTest.cleanupTestStreams(streamName);
      await apiServices.streamsTest.disableSignificantEvents();

      await esClient.deleteByQuery({
        index: featureStorageSettings.name,
        query: { term: { stream_name: streamName } },
        refresh: true,
      });
    });

    apiTest(
      'writes a feature knowledge indicator and returns acknowledged: true with a uuid',
      async ({ apiClient, samlAuth }) => {
        const { cookieHeader } = await samlAuth.asStreamsAdmin();

        const featureId = `test-feature-${uuidv4().slice(0, 8)}`;

        const res = await apiClient.post('api/agent_builder/tools/_execute', {
          headers: { ...PUBLIC_API_HEADERS, ...cookieHeader },
          body: {
            tool_id: TOOL_ID,
            tool_params: {
              stream_name: streamName,
              id: featureId,
              type: 'error_pattern',
              title: 'Test feature',
              description: 'A feature written by the agent tool test',
              properties: { test: true },
              confidence: 80,
              tags: ['test'],
            },
          },
          responseType: 'json',
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.results).toHaveLength(1);
        expect(res.body.results[0].type).toBe('other');

        const output = res.body.results[0].data as { acknowledged: boolean; uuid: string };
        expect(output.acknowledged).toBe(true);
        expect(typeof output.uuid).toBe('string');
        expect(output.uuid.length).toBeGreaterThan(0);
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
                id: 'test-feature',
                type: 'error_pattern',
                description: 'Should fail',
                properties: {},
                confidence: 50,
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
