/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { persistFeaturesToolHandler } from './handler';
import { reconcileInferredFeatures } from '../../../lib/significant_events/features/reconcile_features';

jest.mock('../../../lib/significant_events/features/reconcile_features', () => ({
  reconcileInferredFeatures: jest.fn(),
  toFeatureSummary: ({ id, title }: { id: string; title?: string }) => ({
    id,
    title: title ?? id,
  }),
}));

const reconcileMock = reconcileInferredFeatures as jest.MockedFunction<
  typeof reconcileInferredFeatures
>;

describe('persistFeaturesToolHandler', () => {
  const logger = loggingSystemMock.createLogger();

  const featureInput = {
    id: 'checkout-api',
    type: 'entity' as const,
    subtype: 'service',
    title: 'Checkout API',
    description: 'Checkout service',
    properties: { name: 'checkout-api' },
    confidence: 90,
    evidence: ['service.name=checkout-api'],
    tags: ['service'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    reconcileMock.mockReturnValue({
      newFeatures: [{ ...featureInput, stream_name: 'logs.test', run_id: 'run-1' }],
      updatedFeatures: [],
      codeIgnoredCount: 0,
      remappedCount: 0,
    });
  });

  it('reconciles and bulks new features', async () => {
    const kiClient = {
      getFeatures: jest.fn().mockResolvedValue({ hits: [] }),
      getExcludedFeatures: jest.fn().mockResolvedValue({ hits: [] }),
      bulk: jest.fn().mockResolvedValue({ applied: 1, skipped: 0 }),
      getDefaultExpiresAt: jest.fn().mockReturnValue('2026-09-12T00:00:00.000Z'),
    };

    const result = await persistFeaturesToolHandler({
      kiClient: kiClient as never,
      streamName: 'logs.test',
      runId: 'run-1',
      features: [featureInput],
      logger,
    });

    expect(kiClient.bulk).toHaveBeenCalledTimes(1);
    expect(result.newFeatures).toEqual([{ id: 'checkout-api', title: 'Checkout API' }]);
    expect(result.discoveredFeatures).toEqual([{ id: 'checkout-api', title: 'Checkout API' }]);
  });

  it('skips bulk when reconcile produces no changes', async () => {
    reconcileMock.mockReturnValue({
      newFeatures: [],
      updatedFeatures: [],
      codeIgnoredCount: 0,
      remappedCount: 0,
    });

    const kiClient = {
      getFeatures: jest.fn().mockResolvedValue({ hits: [] }),
      getExcludedFeatures: jest.fn().mockResolvedValue({ hits: [] }),
      bulk: jest.fn(),
      getDefaultExpiresAt: jest.fn(),
    };

    const result = await persistFeaturesToolHandler({
      kiClient: kiClient as never,
      streamName: 'logs.test',
      runId: 'run-1',
      features: [featureInput],
      logger,
    });

    expect(kiClient.bulk).not.toHaveBeenCalled();
    expect(result.discoveredFeatures).toEqual([]);
  });
});
