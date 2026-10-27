/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RunQuotaConsumeResponse, RunQuotaGroup } from '../../../common/run_quotas';
import { mutateRunQuotaLedger, readRunQuotaSettings } from './repository';
import { dayKey, resolveDailyWindow } from './window';
import type { RunQuotaSavedObjectsRepository } from './repository';

export const consumeRunQuota = async ({
  internalRepository,
  group,
  isCostLimitReached,
}: {
  internalRepository: RunQuotaSavedObjectsRepository;
  group: RunQuotaGroup;
  isCostLimitReached: (costLimitUsd: number) => Promise<boolean>;
}): Promise<RunQuotaConsumeResponse> => {
  const date = dayKey(resolveDailyWindow());
  const settings = await readRunQuotaSettings(internalRepository);
  const limit = settings.limits[group];

  // Checked before the ledger is touched so a cost denial does not use up a counted admission.
  // Independent of `enabled`, which only covers the run count limits.
  if (settings.costLimitUsd > 0 && (await isCostLimitReached(settings.costLimitUsd))) {
    return { allowed: false };
  }

  return mutateRunQuotaLedger<RunQuotaConsumeResponse>({
    internalRepository,
    date,
    group,
    mutation: (ledger) => {
      if (settings.enabled && limit > 0 && ledger.count >= limit) {
        return { result: { allowed: false } };
      }

      return {
        attributes: { count: ledger.count + 1 },
        result: { allowed: true },
      };
    },
  });
};
