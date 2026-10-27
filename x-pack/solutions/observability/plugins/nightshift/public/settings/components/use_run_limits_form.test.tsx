/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { act, renderHook } from '@testing-library/react';
import type {
  RunQuotaSettingsUpdate,
  RunQuotasResponse,
} from '@kbn/significant-events-plugin/common';
import { useRunQuotas, useUpdateRunQuotas } from '../hooks/use_significant_events_run_quotas';
import { useRunLimitsForm } from './use_run_limits_form';

jest.mock('../hooks/use_significant_events_run_quotas');

const mockUseRunQuotas = useRunQuotas as jest.MockedFunction<typeof useRunQuotas>;
const mockUseUpdateRunQuotas = useUpdateRunQuotas as jest.MockedFunction<typeof useUpdateRunQuotas>;
const save = jest.fn<Promise<RunQuotasResponse>, [RunQuotaSettingsUpdate]>();

const response = (overrides: Partial<RunQuotasResponse> = {}): RunQuotasResponse => ({
  enabled: true,
  limits: { detection: 100, investigation: 30, ki_extraction: 20 },
  costLimitUsd: 0,
  counts: { detection: 4, investigation: 3, ki_extraction: 2 },
  window: {
    start: '2026-09-03T00:00:00.000Z',
    resetsAt: '2026-09-04T00:00:00.000Z',
    timezone: 'UTC',
  },
  canManage: true,
  ...overrides,
});

const setup = (data: RunQuotasResponse = response()) => {
  mockUseRunQuotas.mockReturnValue({ data, isLoading: false, isError: false } as never);
  mockUseUpdateRunQuotas.mockReturnValue({ save, isSaving: false });
  save.mockResolvedValue(data);
  return renderHook(() => useRunLimitsForm({ groups: ['detection', 'ki_extraction'] }));
};

describe('useRunLimitsForm cost limit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts from the saved limit without being dirty', () => {
    const { result } = setup(response({ costLimitUsd: 25 }));

    expect(result.current.costLimit).toBe(25);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.update).toBeUndefined();
  });

  it('builds an update with only the cost limit when only it changed', () => {
    const { result } = setup(response({ costLimitUsd: 25 }));

    act(() => result.current.updateCostLimitDraft(12.5));

    expect(result.current.isDirty).toBe(true);
    expect(result.current.update).toEqual({ costLimitUsd: 12.5 });
  });

  it('combines the cost limit with run limit edits in one update', () => {
    const { result } = setup(response({ costLimitUsd: 25 }));

    act(() => result.current.updateLimitDraft('detection', 50));
    act(() => result.current.updateCostLimitDraft(30));

    expect(result.current.update).toEqual({ limits: { detection: 50 }, costLimitUsd: 30 });
  });

  it('blocks the save for an invalid amount', () => {
    const { result } = setup(response({ costLimitUsd: 25 }));

    act(() => result.current.updateCostLimitDraft(''));

    expect(result.current.isDirty).toBe(true);
    expect(result.current.update).toBeUndefined();
  });

  it('does not drop an invalid run limit edit when the cost limit is also changed', () => {
    const { result } = setup(response({ costLimitUsd: 25 }));

    act(() => result.current.updateLimitDraft('detection', ''));
    act(() => result.current.updateCostLimitDraft(30));

    expect(result.current.update).toBeUndefined();
  });

  it('switches off to zero and back to the last enabled amount', () => {
    const { result } = setup(response({ costLimitUsd: 25 }));

    act(() => result.current.setCostLimitEnabled(false));
    expect(result.current.costLimit).toBe(0);
    expect(result.current.update).toEqual({ costLimitUsd: 0 });

    act(() => result.current.setCostLimitEnabled(true));
    expect(result.current.costLimit).toBe(25);
    expect(result.current.isDirty).toBe(false);
  });

  it('offers a default amount when switched on without a previous one', () => {
    const { result } = setup();

    act(() => result.current.setCostLimitEnabled(true));

    expect(result.current.costLimit).toBe(10);
  });

  it('discards the cost limit edit on cancel', () => {
    const { result } = setup(response({ costLimitUsd: 25 }));

    act(() => result.current.updateCostLimitDraft(30));
    act(() => result.current.cancel());

    expect(result.current.costLimit).toBe(25);
    expect(result.current.isDirty).toBe(false);
  });

  it('saves the update and returns to the saved value', async () => {
    const { result, rerender } = setup(response({ costLimitUsd: 25 }));
    const saved = response({ costLimitUsd: 12.5 });
    save.mockResolvedValue(saved);

    act(() => result.current.updateCostLimitDraft(12.5));
    await act(async () => {
      await result.current.requestSave();
    });
    mockUseRunQuotas.mockReturnValue({ data: saved, isLoading: false, isError: false } as never);
    rerender();

    expect(save).toHaveBeenCalledWith({ costLimitUsd: 12.5 });
    expect(result.current.costLimit).toBe(12.5);
    expect(result.current.isDirty).toBe(false);
  });
});
