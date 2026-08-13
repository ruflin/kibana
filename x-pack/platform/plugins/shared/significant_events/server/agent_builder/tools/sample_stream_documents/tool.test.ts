/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import type { StreamsServer } from '@kbn/streams-plugin/server/types';
import type { GetScopedClients } from '../../../routes/types';
import {
  createSampleStreamDocumentsTool,
  SIGNIFICANT_EVENTS_SAMPLE_STREAM_DOCUMENTS_TOOL_ID,
} from './tool';

jest.mock('../../../routes/utils/assert_significant_events_access', () => ({
  assertSignificantEventsAccess: jest.fn(),
}));

describe('ki_sample_documents tool', () => {
  const logger = loggingSystemMock.createLogger();
  const server = {} as unknown as StreamsServer;

  it('uses the expected tool id and never asks for confirmation', () => {
    const tool = createSampleStreamDocumentsTool({
      getScopedClients: jest.fn() as unknown as GetScopedClients,
      server,
      logger,
    });

    expect(tool.id).toBe(SIGNIFICANT_EVENTS_SAMPLE_STREAM_DOCUMENTS_TOOL_ID);
    expect(tool.id).toBe('platform.sig_events.ki_sample_documents');
    expect(tool.confirmation?.askUser).toBe('never');
  });
});
