/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { i18n } from '@kbn/i18n';
import type { RunQuotaGroup } from '@kbn/significant-events-plugin/common';
import { useRunQuotas, useUpdateRunQuotas } from '../hooks/use_significant_events_run_quotas';
import {
  DEFAULT_ENABLED_COST_LIMIT_USD,
  NO_COST_LIMIT,
  isValidCostLimitDraft,
  isValidEnabledCostLimitDraft,
  type CostLimitDraft,
} from './cost_limit_draft';
import {
  buildRunQuotaSettingsUpdate,
  createRunQuotaDraftState,
  hasRunQuotaDraftChanges,
  isLowerFiniteLimit,
  setRunLimitEnabled,
  type RunLimitDraft,
  type RunQuotaDraftState,
} from './run_limit_draft';

export interface RunLimitSaveWarnings {
  loweringGroups: RunQuotaGroup[];
}

export type RunLimitSaveRequestResult = 'saved' | 'needs-confirmation' | 'failed' | 'noop';
export type RunLimitConfirmedSaveResult = 'saved' | 'failed';

const hasSaveWarnings = ({ loweringGroups }: RunLimitSaveWarnings): boolean =>
  loweringGroups.length > 0;

export const useRunLimitsForm = ({ groups }: { groups: readonly RunQuotaGroup[] }) => {
  const quotas = useRunQuotas();
  const { save, isSaving } = useUpdateRunQuotas();
  const [draftState, setDraftState] = useState<RunQuotaDraftState>();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [saveError, setSaveError] = useState<Error>();
  // Undefined until the user edits the cost limit, so the saved value is shown without syncing.
  const [costLimitDraft, setCostLimitDraft] = useState<CostLimitDraft>();
  const lastEnabledCostLimit = useRef<number>(DEFAULT_ENABLED_COST_LIMIT_USD);
  const savedCostLimit = quotas.data?.costLimitUsd ?? NO_COST_LIMIT;
  const costLimit = costLimitDraft ?? savedCostLimit;
  const isCostLimitDirty = costLimitDraft !== undefined && costLimitDraft !== savedCostLimit;

  useEffect(() => {
    if (!quotas.data) {
      return;
    }
    setDraftState((current) =>
      current && hasRunQuotaDraftChanges(current) ? current : createRunQuotaDraftState(quotas.data)
    );
  }, [quotas.data]);

  const update = useMemo(() => {
    const runLimitsUpdate = draftState ? buildRunQuotaSettingsUpdate(draftState) : undefined;
    if (!isCostLimitDirty) {
      return runLimitsUpdate;
    }
    // An invalid run limit edit must block the save rather than be dropped from it.
    const hasRunLimitChanges = draftState ? hasRunQuotaDraftChanges(draftState) : false;
    if (!isValidCostLimitDraft(costLimit) || (hasRunLimitChanges && !runLimitsUpdate)) {
      return undefined;
    }
    return { ...runLimitsUpdate, costLimitUsd: costLimit };
  }, [costLimit, draftState, isCostLimitDirty]);

  const warnings = useMemo<RunLimitSaveWarnings>(() => {
    if (!draftState || !quotas.data) {
      return {
        loweringGroups: [],
      };
    }
    const response = quotas.data;
    const loweringGroups = groups.filter((group) => {
      const next = draftState.draft.limits[group];
      return (
        next !== draftState.saved.limits[group] &&
        isLowerFiniteLimit(draftState.saved.limits[group], next) &&
        response.counts[group] >= next
      );
    });

    return {
      loweringGroups,
    };
  }, [draftState, groups, quotas.data]);

  const performSave = useCallback(async (): Promise<RunLimitConfirmedSaveResult> => {
    if (!update) {
      return 'saved';
    }

    setSaveError(undefined);
    try {
      const response = await save(update);
      setDraftState(createRunQuotaDraftState(response));
      setCostLimitDraft(undefined);
      setShowConfirmation(false);
      return 'saved';
    } catch (error) {
      setShowConfirmation(false);
      setSaveError(error instanceof Error ? error : new Error(String(error)));
      return 'failed';
    }
  }, [save, update]);

  const requestSave = useCallback(async (): Promise<RunLimitSaveRequestResult> => {
    if (!update) {
      return 'noop';
    }
    if (hasSaveWarnings(warnings)) {
      setShowConfirmation(true);
      return 'needs-confirmation';
    }
    return performSave();
  }, [performSave, update, warnings]);

  const confirmAndSave = useCallback(
    async (): Promise<RunLimitConfirmedSaveResult> => performSave(),
    [performSave]
  );

  const updateLimitDraft = useCallback((group: RunQuotaGroup, limit: RunLimitDraft) => {
    setSaveError(undefined);
    setDraftState((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              limits: {
                ...current.draft.limits,
                [group]: limit,
              },
            },
          }
        : current
    );
  }, []);

  const setLimitEnabled = useCallback((group: RunQuotaGroup, enabled: boolean) => {
    setSaveError(undefined);
    setDraftState((current) => (current ? setRunLimitEnabled(current, group, enabled) : current));
  }, []);

  const updateCostLimitDraft = useCallback((nextCostLimit: CostLimitDraft) => {
    setSaveError(undefined);
    if (isValidEnabledCostLimitDraft(nextCostLimit)) {
      lastEnabledCostLimit.current = nextCostLimit;
    }
    setCostLimitDraft(nextCostLimit);
  }, []);

  const setCostLimitEnabled = useCallback(
    (enabled: boolean) => {
      updateCostLimitDraft(enabled ? lastEnabledCostLimit.current : NO_COST_LIMIT);
    },
    [updateCostLimitDraft]
  );

  const cancel = useCallback(() => {
    if (quotas.data) {
      setDraftState(createRunQuotaDraftState(quotas.data));
    }
    setCostLimitDraft(undefined);
    setSaveError(undefined);
    setShowConfirmation(false);
  }, [quotas.data]);

  const confirmationTitle = i18n.translate(
    'xpack.nightshift.settings.runLimits.loweringConfirmTitle',
    {
      defaultMessage: 'Lower limits to values already reached?',
    }
  );

  const confirmationButtonText = i18n.translate(
    'xpack.nightshift.settings.runLimits.loweringConfirmButtonLabel',
    {
      defaultMessage: 'Save lower limits',
    }
  );

  return {
    quotas,
    draftState,
    update,
    isDirty: (draftState ? hasRunQuotaDraftChanges(draftState) : false) || isCostLimitDirty,
    costLimit,
    updateCostLimitDraft,
    setCostLimitEnabled,
    isSaving,
    canManage: quotas.data?.canManage === true,
    saveError,
    updateLimitDraft,
    setLimitEnabled,
    cancel,
    requestSave,
    confirmAndSave,
    showConfirmation,
    confirmationTitle,
    confirmationButtonText,
    warnings,
    closeConfirmation: () => setShowConfirmation(false),
  };
};

export type RunLimitsForm = ReturnType<typeof useRunLimitsForm>;
