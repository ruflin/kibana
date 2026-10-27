/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SavedObjectsErrorHelpers } from '@kbn/core/server';
import type { RunQuotaSettingsAttributes } from './saved_objects';
import {
  patchRunQuotaSettings,
  readRunQuotaSettings,
  type RunQuotaSavedObjectsRepository,
} from './repository';

const makeSavedObject = <T extends Record<string, unknown>>(
  attributes: T,
  version = 'WzEsMV0='
) => ({
  type: 'settings',
  id: 'settings',
  attributes,
  references: [],
  version,
});

const makeRepository = (): jest.Mocked<RunQuotaSavedObjectsRepository> =>
  ({
    create: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<RunQuotaSavedObjectsRepository>);

describe('run quota settings repository', () => {
  it('returns enabled enforcement and the default limits when settings do not exist', async () => {
    const repository = makeRepository();
    repository.get.mockRejectedValue(
      SavedObjectsErrorHelpers.createGenericNotFoundError('settings', 'settings')
    );

    await expect(readRunQuotaSettings(repository)).resolves.toEqual({
      enabled: true,
      limits: {
        detection: 15,
        investigation: 3,
        ki_extraction: 3,
      },
      costLimitUsd: 0,
    });
  });

  it('preserves unrelated fields and groups when a settings patch conflicts', async () => {
    const repository = makeRepository();
    const first: RunQuotaSettingsAttributes = {
      enabled: false,
      costLimitUsd: 0,
      limits: {
        detection: 100,
        investigation: 30,
        ki_extraction: 20,
        future_group: 9,
      },
      futureTopLevel: { retained: 'first' },
    };
    const winner: RunQuotaSettingsAttributes = {
      ...first,
      enabled: true,
      limits: {
        ...first.limits,
        investigation: 40,
      },
      futureTopLevel: { retained: 'winner' },
    };
    repository.get
      .mockResolvedValueOnce(makeSavedObject(first))
      .mockResolvedValueOnce(makeSavedObject(winner, 'WzIsMV0='));
    repository.update
      .mockRejectedValueOnce(SavedObjectsErrorHelpers.createConflictError('settings', 'settings'))
      .mockImplementation(async (_type, _id, attributes) =>
        makeSavedObject(attributes as RunQuotaSettingsAttributes, 'WzMsMV0=')
      );

    await expect(
      patchRunQuotaSettings(repository, {
        limits: { detection: 120 },
      })
    ).resolves.toEqual({
      enabled: true,
      costLimitUsd: 0,
      futureTopLevel: { retained: 'winner' },
      limits: {
        detection: 120,
        investigation: 40,
        ki_extraction: 20,
        future_group: 9,
      },
    });
  });

  it('merges concurrent category activation while normalizing legacy disabled limits', async () => {
    const repository = makeRepository();
    const legacy: RunQuotaSettingsAttributes = {
      enabled: false,
      costLimitUsd: 0,
      limits: {
        detection: 100,
        investigation: 30,
        ki_extraction: 20,
        future_group: 9,
      },
    };
    const concurrentWinner: RunQuotaSettingsAttributes = {
      enabled: true,
      costLimitUsd: 0,
      limits: {
        detection: 15,
        investigation: 0,
        ki_extraction: 0,
        future_group: 9,
      },
    };
    repository.get
      .mockResolvedValueOnce(makeSavedObject(legacy))
      .mockResolvedValueOnce(makeSavedObject(concurrentWinner, 'WzIsMV0='));
    repository.update
      .mockRejectedValueOnce(SavedObjectsErrorHelpers.createConflictError('settings', 'settings'))
      .mockImplementation(async (_type, _id, attributes) =>
        makeSavedObject(attributes as RunQuotaSettingsAttributes, 'WzMsMV0=')
      );

    await expect(
      patchRunQuotaSettings(repository, {
        activateLimits: { investigation: 3 },
      })
    ).resolves.toEqual({
      enabled: true,
      costLimitUsd: 0,
      limits: {
        detection: 15,
        investigation: 3,
        ki_extraction: 0,
        future_group: 9,
      },
    });

    expect(repository.update.mock.calls[0][2]).toEqual({
      enabled: true,
      costLimitUsd: 0,
      limits: {
        detection: 0,
        investigation: 3,
        ki_extraction: 0,
        future_group: 9,
      },
    });
  });

  it('defaults the cost limit for settings stored before it existed', async () => {
    const repository = makeRepository();
    repository.get.mockResolvedValue(
      makeSavedObject({
        enabled: true,
        limits: { detection: 5, investigation: 5, ki_extraction: 5 },
      } as RunQuotaSettingsAttributes)
    );

    await expect(readRunQuotaSettings(repository)).resolves.toEqual(
      expect.objectContaining({ costLimitUsd: 0 })
    );
  });

  it('stores a patched cost limit next to the existing run limits', async () => {
    const repository = makeRepository();
    const current: RunQuotaSettingsAttributes = {
      enabled: true,
      costLimitUsd: 0,
      limits: { detection: 5, investigation: 5, ki_extraction: 5 },
    };
    repository.get.mockResolvedValue(makeSavedObject(current));
    repository.update.mockImplementation(async (_type, _id, attributes) =>
      makeSavedObject(attributes as RunQuotaSettingsAttributes, 'WzMsMV0=')
    );

    await expect(patchRunQuotaSettings(repository, { costLimitUsd: 12.5 })).resolves.toEqual({
      ...current,
      costLimitUsd: 12.5,
    });
    expect(repository.update.mock.calls[0][2]).toEqual({
      enabled: true,
      costLimitUsd: 12.5,
      limits: current.limits,
    });
  });
});
