/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SavedObjectsErrorHelpers } from '@kbn/core/server';
import type { Logger } from '@kbn/core/server';
import { StatusError } from '../errors/status_error';
import {
  SIGNIFICANT_EVENTS_DATA_VIEWS_SO_ID,
  SIGNIFICANT_EVENTS_DATA_VIEWS_SO_TYPE,
} from './saved_object';
import { createDataViewsService } from './data_views_service';
import {
  deleteEsqlView,
  getEsqlView,
  listEsqlViews,
  upsertEsqlView,
} from '../esql_views/manage_esql_views';

jest.mock('../esql_views/manage_esql_views', () => ({
  deleteEsqlView: jest.fn(),
  getEsqlView: jest.fn(),
  listEsqlViews: jest.fn(),
  upsertEsqlView: jest.fn(),
}));

const soGet = jest.fn();
const soCreate = jest.fn();
const soClient = {
  get: soGet,
  create: soCreate,
};
const esClient = {} as never;
const logger = { warn: jest.fn(), debug: jest.fn() } as unknown as Logger;
const bulkDisableRules = jest.fn();
const bulkEnableRules = jest.fn();
const findRules = jest.fn();

const createService = () =>
  createDataViewsService({
    soClient: soClient as never,
    esClient,
    logger,
    alertingV2RulesClient: {
      bulkDisableRules,
      bulkEnableRules,
      findRules,
    } as never,
  });

const existingView = {
  name: '$.logs.checkout',
  query: 'FROM logs.checkout',
};

describe('createDataViewsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    soGet.mockRejectedValue(
      SavedObjectsErrorHelpers.createGenericNotFoundError(
        SIGNIFICANT_EVENTS_DATA_VIEWS_SO_TYPE,
        SIGNIFICANT_EVENTS_DATA_VIEWS_SO_ID
      )
    );
    soCreate.mockResolvedValue({});
    findRules.mockResolvedValue({ items: [], total: 0 });
    (listEsqlViews as jest.Mock).mockResolvedValue([existingView]);
    (getEsqlView as jest.Mock).mockResolvedValue(existingView);
    (upsertEsqlView as jest.Mock).mockResolvedValue(undefined);
    (deleteEsqlView as jest.Mock).mockResolvedValue(undefined);
  });

  it('stores a catalog view by name without creating or overwriting the ES view', async () => {
    const service = createService();
    const view = await service.addExisting('$.logs.checkout');

    expect(view).toEqual({
      name: '$.logs.checkout',
      enabled: true,
      owned: false,
      query: existingView.query,
    });
    expect(upsertEsqlView).not.toHaveBeenCalled();
    expect(deleteEsqlView).not.toHaveBeenCalled();
    expect(soCreate).toHaveBeenCalledWith(
      SIGNIFICANT_EVENTS_DATA_VIEWS_SO_TYPE,
      { views: [view] },
      { id: SIGNIFICANT_EVENTS_DATA_VIEWS_SO_ID, overwrite: true }
    );
  });

  it('hides system views from the catalog', async () => {
    (listEsqlViews as jest.Mock).mockResolvedValue([
      existingView,
      { name: '$.rule-events', query: 'FROM .rule-events' },
    ]);

    await expect(createService().listCatalog()).resolves.toEqual([existingView]);
  });

  it('creates owned views under the nightshift namespace', async () => {
    (getEsqlView as jest.Mock).mockRejectedValue(new Error('not found'));
    const service = createService();
    const view = await service.createOwned({
      name: 'prod-logs',
      query: 'FROM logs-*',
      spaceId: 'default',
    });

    expect(view.name).toBe('$.nightshift.default.prod-logs');
    expect(view.owned).toBe(true);
    expect(upsertEsqlView).toHaveBeenCalledWith({
      esClient,
      logger,
      name: '$.nightshift.default.prod-logs',
      query: 'FROM logs-*',
    });
  });

  it('does not overwrite a pre-existing ES view when creating', async () => {
    (getEsqlView as jest.Mock).mockResolvedValue({
      name: '$.nightshift.default.prod-logs',
      query: 'FROM logs-old',
    });

    await expect(
      createService().createOwned({
        name: 'prod-logs',
        query: 'FROM logs-*',
        spaceId: 'default',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(upsertEsqlView).not.toHaveBeenCalled();
  });

  it('returns only enabled views from getEnabled', async () => {
    soGet.mockResolvedValue({
      attributes: {
        views: [
          { name: '$.a', enabled: true, owned: false },
          { name: '$.b', enabled: false, owned: true },
        ],
      },
    });

    await expect(createService().getEnabled()).resolves.toEqual([
      { name: '$.a', enabled: true, owned: false },
    ]);
  });

  it('pauses rules when a view is turned off and does not delete the ES view', async () => {
    soGet.mockResolvedValue({
      attributes: {
        views: [{ name: '$.logs.checkout', enabled: true, owned: false }],
      },
    });
    findRules.mockResolvedValue({ items: [{ id: 'rule-1' }], total: 1 });

    await createService().setEnabled('$.logs.checkout', false);

    expect(bulkDisableRules).toHaveBeenCalledWith({ ids: ['rule-1'] });
    expect(deleteEsqlView).not.toHaveBeenCalled();
  });

  it('deletes the ES view only when removing an owned view', async () => {
    soGet.mockResolvedValue({
      attributes: {
        views: [
          { name: '$.logs.checkout', enabled: true, owned: false },
          { name: '$.nightshift.default.prod-logs', enabled: true, owned: true },
        ],
      },
    });

    await createService().remove('$.logs.checkout');
    expect(deleteEsqlView).not.toHaveBeenCalled();

    soGet.mockResolvedValue({
      attributes: {
        views: [{ name: '$.nightshift.default.prod-logs', enabled: true, owned: true }],
      },
    });
    await createService().remove('$.nightshift.default.prod-logs');
    expect(deleteEsqlView).toHaveBeenCalledWith({
      esClient,
      logger,
      name: '$.nightshift.default.prod-logs',
    });
  });

  it('rejects adding a system view', async () => {
    await expect(createService().addExisting('$.rule-events')).rejects.toBeInstanceOf(StatusError);
    expect(upsertEsqlView).not.toHaveBeenCalled();
  });
});
