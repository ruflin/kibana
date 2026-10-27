/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  DEFAULT_RUN_QUOTA_SETTINGS,
  type RunQuotaConsumeRequest,
} from '../../../../common/run_quotas';
import {
  NIGHTSHIFT_API_PRIVILEGES,
  NIGHTSHIFT_MANAGE_AND_CONFIGURE_API_PRIVILEGES,
} from '@kbn/nightshift-shared';
import type { SignificantEventsServer } from '../../../types';
import type {
  RunQuotaSavedObjectsRepository,
  RunQuotaSettingsAttributes,
} from '../../../lib/run_quotas';
import {
  assertCanManageRunQuotas,
  canManageRunQuotas,
  consumeRunQuota,
  createRunQuotaInternalRepository,
  patchRunQuotaSettings,
  readRunQuotaLedger,
  readRunQuotaSettings,
} from '../../../lib/run_quotas';
import { createDailyCostLimitCheck } from '../../../lib/cost/daily_cost_limit';
import type { PriceService } from '../../../lib/cost/price_service';
import { internalRunQuotaRoutes } from './route';

jest.mock('../../../lib/cost/daily_cost_limit', () => ({
  createDailyCostLimitCheck: jest.fn(),
}));

jest.mock('../../utils/assert_significant_events_access', () => ({
  assertSignificantEventsAccess: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../lib/run_quotas', () => ({
  ...jest.requireActual('../../../lib/run_quotas'),
  assertCanManageRunQuotas: jest.fn(),
  canManageRunQuotas: jest.fn(),
  consumeRunQuota: jest.fn(),
  createRunQuotaInternalRepository: jest.fn(),
  patchRunQuotaSettings: jest.fn(),
  readRunQuotaLedger: jest.fn(),
  readRunQuotaSettings: jest.fn(),
}));

const getRoute = internalRunQuotaRoutes['GET /internal/significant_events/run_quotas'];
const putRoute = internalRunQuotaRoutes['PUT /internal/significant_events/run_quotas'];
const consumeRoute =
  internalRunQuotaRoutes['POST /internal/significant_events/run_quotas/_consume'];

const repository = {} as RunQuotaSavedObjectsRepository;
const server = {} as SignificantEventsServer;
const request = {};

const defaultSettings: RunQuotaSettingsAttributes = {
  enabled: DEFAULT_RUN_QUOTA_SETTINGS.enabled,
  limits: { ...DEFAULT_RUN_QUOTA_SETTINGS.limits },
  costLimitUsd: DEFAULT_RUN_QUOTA_SETTINGS.costLimitUsd,
};

const priceService = {} as PriceService;
const isCostLimitReached = jest.fn();

const handlerParams = {
  request,
  server,
  priceService,
  getScopedClients: jest.fn().mockResolvedValue({ licensing: {} }),
};

const mockLedgerCounts = (counts: {
  detection: number;
  investigation: number;
  ki_extraction: number;
}) => {
  jest.mocked(readRunQuotaLedger).mockImplementation(async (_repository, date, group) => ({
    date,
    group,
    count: counts[group],
  }));
};

describe('Significant Events run quota routes', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T08:30:00.000Z'));
    jest.mocked(assertCanManageRunQuotas).mockReset().mockResolvedValue(undefined);
    jest.mocked(canManageRunQuotas).mockReset().mockResolvedValue(false);
    jest.mocked(consumeRunQuota).mockReset().mockResolvedValue({ allowed: true });
    jest
      .mocked(createRunQuotaInternalRepository)
      .mockReset()
      .mockReturnValue(repository as never);
    jest.mocked(createDailyCostLimitCheck).mockReset().mockReturnValue(isCostLimitReached);
    jest.mocked(patchRunQuotaSettings).mockReset();
    jest.mocked(readRunQuotaSettings).mockReset().mockResolvedValue(defaultSettings);
    jest.mocked(readRunQuotaLedger).mockReset();
    mockLedgerCounts({ detection: 0, investigation: 0, ki_extraction: 0 });
    handlerParams.getScopedClients.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers exactly the three routes with their space-scoped privileges', () => {
    expect(Object.keys(internalRunQuotaRoutes).sort()).toEqual(
      [
        'GET /internal/significant_events/run_quotas',
        'POST /internal/significant_events/run_quotas/_consume',
        'PUT /internal/significant_events/run_quotas',
      ].sort()
    );
    expect(getRoute.security.authz).toEqual({
      requiredPrivileges: [NIGHTSHIFT_API_PRIVILEGES.read],
    });
    expect(putRoute.security.authz).toEqual({
      requiredPrivileges: NIGHTSHIFT_MANAGE_AND_CONFIGURE_API_PRIVILEGES,
    });
    expect(consumeRoute.security.authz).toEqual({
      requiredPrivileges: [NIGHTSHIFT_API_PRIVILEGES.manage],
    });
  });

  it('accepts only non-empty bounded settings updates', () => {
    expect(putRoute.params.safeParse({ body: { enabled: true } }).success).toBe(true);
    expect(putRoute.params.safeParse({ body: { limits: { detection: 0 } } }).success).toBe(true);
    expect(putRoute.params.safeParse({ body: { costLimitUsd: 12.5 } }).success).toBe(true);
    expect(putRoute.params.safeParse({ body: { costLimitUsd: 0 } }).success).toBe(true);
    expect(
      putRoute.params.safeParse({
        body: { activateLimits: { detection: 15 }, costLimitUsd: 10 },
      }).success
    ).toBe(true);
    expect(putRoute.params.safeParse({ body: { activateLimits: { detection: 15 } } }).success).toBe(
      true
    );
    expect(
      putRoute.params.safeParse({
        body: {
          enabled: false,
          limits: { detection: 10_000, investigation: 30, ki_extraction: 20 },
        },
      }).success
    ).toBe(true);

    for (const body of [
      {},
      { limits: {} },
      { limits: { detection: -1 } },
      { limits: { detection: 10_001 } },
      { limits: { detection: 1.5 } },
      { limits: { memory: 1 } },
      { activateLimits: {} },
      { activateLimits: { detection: 0 } },
      { activateLimits: { memory: 1 } },
      { enabled: true, activateLimits: { detection: 15 } },
      { costLimitUsd: -1 },
      { costLimitUsd: 1_000_001 },
      { costLimitUsd: '5' },
    ]) {
      expect(putRoute.params.safeParse({ body }).success).toBe(false);
    }
  });

  it('accepts the discriminated consume bodies without identifiers', () => {
    for (const body of [
      { group: 'detection' },
      { group: 'ki_extraction' },
      { group: 'investigation' },
    ]) {
      expect(consumeRoute.params.safeParse({ body }).success).toBe(true);
    }

    for (const body of [
      { group: 'investigation', critical: false },
      { group: 'investigation', critical: true },
      { group: 'detection', critical: false },
      { group: 'detection', executionId: 'execution' },
      { group: 'investigation', eventId: 'event' },
      { group: 'memory' },
    ]) {
      expect(consumeRoute.params.safeParse({ body }).success).toBe(false);
    }
  });

  it('returns configured limits and current-day counts while enforcement is disabled', async () => {
    const settings: RunQuotaSettingsAttributes = {
      enabled: false,
      costLimitUsd: 7.5,
      limits: {
        detection: 0,
        investigation: 30,
        ki_extraction: 0,
      },
    };
    jest.mocked(readRunQuotaSettings).mockResolvedValue(settings);
    jest.mocked(canManageRunQuotas).mockResolvedValue(false);
    mockLedgerCounts({ detection: 17, investigation: 8, ki_extraction: 4 });

    const response = await getRoute.handler({
      ...handlerParams,
      params: {},
    } as never);

    expect(response).toEqual({
      enabled: false,
      limits: settings.limits,
      costLimitUsd: 7.5,
      counts: {
        detection: 17,
        investigation: 8,
        ki_extraction: 4,
      },
      window: {
        start: '2026-09-03T00:00:00.000Z',
        resetsAt: '2026-09-04T00:00:00.000Z',
        timezone: 'UTC',
      },
      canManage: false,
    });
    expect(readRunQuotaLedger).toHaveBeenCalledTimes(3);
    expect(readRunQuotaLedger).toHaveBeenCalledWith(repository, '2026-09-03', 'detection');
    expect(readRunQuotaLedger).toHaveBeenCalledWith(repository, '2026-09-03', 'investigation');
    expect(readRunQuotaLedger).toHaveBeenCalledWith(repository, '2026-09-03', 'ki_extraction');
  });

  it('applies an actual partial update and returns the common snapshot', async () => {
    const updated: RunQuotaSettingsAttributes = {
      enabled: true,
      costLimitUsd: 20,
      limits: {
        detection: 0,
        investigation: 30,
        ki_extraction: 20,
      },
    };
    jest.mocked(patchRunQuotaSettings).mockResolvedValue(updated);
    mockLedgerCounts({ detection: 2, investigation: 3, ki_extraction: 4 });

    const response = await putRoute.handler({
      ...handlerParams,
      params: {
        body: {
          enabled: true,
          limits: { detection: 0 },
          costLimitUsd: 20,
        },
      },
    } as never);

    expect(assertCanManageRunQuotas).toHaveBeenCalledWith({ request, server });
    expect(patchRunQuotaSettings).toHaveBeenCalledWith(repository, {
      enabled: true,
      limits: { detection: 0 },
      costLimitUsd: 20,
    });
    expect(response).toEqual({
      enabled: true,
      limits: updated.limits,
      costLimitUsd: 20,
      counts: {
        detection: 2,
        investigation: 3,
        ki_extraction: 4,
      },
      window: {
        start: '2026-09-03T00:00:00.000Z',
        resetsAt: '2026-09-04T00:00:00.000Z',
        timezone: 'UTC',
      },
      canManage: true,
    });
  });

  it.each<RunQuotaConsumeRequest>([
    { group: 'detection' },
    { group: 'ki_extraction' },
    { group: 'investigation' },
  ])('maps $group admission policy at the route boundary', async (body) => {
    await expect(
      consumeRoute.handler({
        ...handlerParams,
        params: { body },
      } as never)
    ).resolves.toEqual({ allowed: true });

    expect(createDailyCostLimitCheck).toHaveBeenCalledWith({ request, server, priceService });
    expect(consumeRunQuota).toHaveBeenCalledWith({
      internalRepository: repository,
      group: body.group,
      isCostLimitReached,
    });
  });
});
