/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Streams } from '@kbn/streams-schema';
import type { DataViewsService } from './data_views_service';
import {
  assertAnalysisUnit,
  listConfiguredViewNames,
  resolveAnalysisDefinition,
} from './resolve_analysis_definition';

const view = {
  name: '$.nightshift.default.prod-logs',
  enabled: true,
  owned: true,
  query: 'FROM logs-* | WHERE service.name == "checkout"',
};

const queryStream = {
  type: 'query',
  name: view.name,
  description: '',
  updated_at: '2026-01-01T00:00:00.000Z',
  query: { view: view.name, esql: view.query },
} as Streams.QueryStream.Definition;

describe('listConfiguredViewNames', () => {
  it('returns configured view names', async () => {
    const dataViewsService = {
      list: jest.fn().mockResolvedValue([view]),
    } as unknown as DataViewsService;

    await expect(listConfiguredViewNames(dataViewsService)).resolves.toEqual([view.name]);
  });
});

describe('assertAnalysisUnit', () => {
  it('skips ensureStream for configured views', async () => {
    const ensureStream = jest.fn();
    const dataViewsService = {
      getByName: jest.fn().mockResolvedValue(view),
    } as unknown as DataViewsService;

    await assertAnalysisUnit({
      name: view.name,
      streamsClient: { ensureStream } as never,
      dataViewsService,
    });

    expect(ensureStream).not.toHaveBeenCalled();
  });

  it('falls back to ensureStream for legacy stream names', async () => {
    const ensureStream = jest.fn().mockResolvedValue(undefined);
    const dataViewsService = {
      getByName: jest.fn().mockResolvedValue(undefined),
    } as unknown as DataViewsService;

    await assertAnalysisUnit({
      name: 'logs.app',
      streamsClient: { ensureStream } as never,
      dataViewsService,
    });

    expect(ensureStream).toHaveBeenCalledWith('logs.app');
  });
});

describe('resolveAnalysisDefinition', () => {
  it('returns a synthetic query stream for configured views', async () => {
    const getStream = jest.fn();
    const dataViewsService = {
      getByName: jest.fn().mockResolvedValue(view),
    } as unknown as DataViewsService;

    const definition = await resolveAnalysisDefinition({
      name: view.name,
      streamsClient: { getStream } as never,
      dataViewsService,
    });

    expect(getStream).not.toHaveBeenCalled();
    expect(definition.type).toBe('query');
    expect(definition.name).toBe(view.name);
    if (definition.type === 'query') {
      expect(definition.query.view).toBe(view.name);
    }
  });

  it('loads a stream definition when the name is not a configured view', async () => {
    const getStream = jest.fn().mockResolvedValue(queryStream);
    const dataViewsService = {
      getByName: jest.fn().mockResolvedValue(undefined),
    } as unknown as DataViewsService;

    await expect(
      resolveAnalysisDefinition({
        name: 'logs.app',
        streamsClient: { getStream } as never,
        dataViewsService,
      })
    ).resolves.toBe(queryStream);
    expect(getStream).toHaveBeenCalledWith('logs.app');
  });
});
