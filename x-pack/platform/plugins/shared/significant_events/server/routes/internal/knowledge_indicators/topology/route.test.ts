/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SignificantEventsMaintenanceState } from '../../../../../common/maintenance/state_machine';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import { internalTopologyRoutes } from './route';

jest.mock('../../../utils/assert_significant_events_access', () => ({
  assertSignificantEventsAccess: jest.fn().mockResolvedValue(undefined),
}));

const mockRegenerateTopology = jest.fn();
const mockResolveConnectorForFeature = jest.fn();

jest.mock('../../../../lib/significant_events/topology/regenerate_topology', () => ({
  regenerateTopology: (...args: unknown[]) => mockRegenerateTopology(...args),
}));

jest.mock('../../../utils/resolve_connector_for_feature', () => ({
  resolveConnectorForFeature: (...args: unknown[]) => mockResolveConnectorForFeature(...args),
}));

const generateRoute =
  internalTopologyRoutes['POST /internal/streams/knowledge_indicators/topology/_generate'];

type GenerateHandlerParams = Parameters<typeof generateRoute.handler>[0];

const makeMaintenanceService = (state: SignificantEventsMaintenanceState = 'enabled') => ({
  getState: jest.fn().mockResolvedValue(state),
});

const makeRequest = () => ({
  events: {
    aborted$: {
      subscribe: jest.fn(),
    },
  },
});

describe('generate topology route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveConnectorForFeature.mockResolvedValue('connector-1');
    mockRegenerateTopology.mockResolvedValue({
      streamNames: ['logs.claims'],
      createdCount: 2,
      connectorId: 'connector-1',
    });
  });

  it('rejects generation with 409 while paused', async () => {
    const getKnowledgeIndicatorClient = jest.fn();
    const handlerParams = {
      params: { body: {} },
      request: makeRequest(),
      getScopedClients: jest.fn().mockResolvedValue({
        licensing: {},
        streamsClient: {},
        inferenceClient: {},
        getKnowledgeIndicatorClient,
      }),
      server: {},
      logger: { get: jest.fn() },
      maintenanceService: makeMaintenanceService('paused'),
    } as unknown as GenerateHandlerParams;

    await expect(generateRoute.handler(handlerParams)).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
    expect(getKnowledgeIndicatorClient).not.toHaveBeenCalled();
    expect(mockRegenerateTopology).not.toHaveBeenCalled();
  });

  it('regenerates topology for the requested streams while enabled', async () => {
    const request = makeRequest();
    const kiClient = {};
    const licensing = {};
    const inferenceClient = {};
    const listStreams = jest.fn().mockResolvedValue([{ name: 'logs.claims' }]);
    const routeLogger = { debug: jest.fn() };
    const handlerParams = {
      params: { body: { streamNames: ['logs.claims'] } },
      request,
      getScopedClients: jest.fn().mockResolvedValue({
        licensing,
        streamsClient: { listStreams },
        inferenceClient,
        getKnowledgeIndicatorClient: jest.fn().mockResolvedValue(kiClient),
      }),
      server: { searchInferenceEndpoints: {} },
      logger: { get: jest.fn().mockReturnValue(routeLogger) },
      maintenanceService: makeMaintenanceService(),
    } as unknown as GenerateHandlerParams;

    await expect(generateRoute.handler(handlerParams)).resolves.toEqual({
      streamNames: ['logs.claims'],
      createdCount: 2,
      connectorId: 'connector-1',
    });

    expect(assertSignificantEventsAccess).toHaveBeenCalledWith({
      server: handlerParams.server,
      licensing,
    });
    expect(mockResolveConnectorForFeature).toHaveBeenCalledWith(
      expect.objectContaining({
        featureName: 'knowledge indicator extraction',
        request,
      })
    );
    expect(mockRegenerateTopology).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedStreamNames: ['logs.claims'],
        connectorId: 'connector-1',
        kiClient,
        inferenceClient,
        logger: routeLogger,
      })
    );
  });
});
