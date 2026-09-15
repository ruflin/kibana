/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { act, renderHook } from '@testing-library/react';
import { OBSERVABILITY_STREAMS_SIGNIFICANT_EVENTS_ENABLED_STREAMS } from '@kbn/management-settings-ids';
import { SignificantEventsWorkflowStatus } from '@kbn/significant-events-schema';
import { useKibana } from '../../../hooks/use_kibana';
import { useNightshiftStreamEnabled } from './use_nightshift_stream_enabled';

jest.mock('../../../hooks/use_kibana', () => ({
  useKibana: jest.fn(),
}));

const mockUseKibana = useKibana as jest.MockedFunction<typeof useKibana>;

const settingsStore: Record<string, string> = {};
const mockSet = jest.fn(async (key: string, value: string) => {
  settingsStore[key] = value;
});
const mockGet = jest.fn((key: string, fallback: string) => settingsStore[key] ?? fallback);
const mockAddError = jest.fn();
const mockScheduleOnboarding = jest.fn(async (streamNames: string[]) => streamNames);
const mockCancelOnboarding = jest.fn(async () => undefined);

const completed = {
  status: SignificantEventsWorkflowStatus.Completed,
  executionId: 'exec-1',
} as const;
const notStarted = {
  status: SignificantEventsWorkflowStatus.NotStarted,
  executionId: null,
} as const;

describe('useNightshiftStreamEnabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(settingsStore)) {
      delete settingsStore[key];
    }
    mockUseKibana.mockReturnValue({
      core: {
        settings: { client: { get: mockGet, set: mockSet } },
        notifications: { toasts: { addError: mockAddError } },
      },
    } as never);
  });

  const renderEnabledHook = (
    streamStatusMap: Parameters<typeof useNightshiftStreamEnabled>[0]['streamStatusMap']
  ) =>
    renderHook(() =>
      useNightshiftStreamEnabled({
        knownStreamNames: ['logs.app', 'logs.nginx'],
        streamStatusMap,
        scheduleOnboarding: mockScheduleOnboarding,
        cancelOnboarding: mockCancelOnboarding,
      })
    );

  it('seeds enabled streams from KI onboarding status when the allowlist is unset', () => {
    const { result } = renderEnabledHook({
      'logs.app': completed,
      'logs.nginx': notStarted,
    });

    expect(result.current.isStreamEnabled('logs.app')).toBe(true);
    expect(result.current.isStreamEnabled('logs.nginx')).toBe(false);
  });

  it('uses the persisted allowlist once it has been written', () => {
    settingsStore[OBSERVABILITY_STREAMS_SIGNIFICANT_EVENTS_ENABLED_STREAMS] = '["logs.nginx"]';

    const { result } = renderEnabledHook({
      'logs.app': completed,
      'logs.nginx': notStarted,
    });

    expect(result.current.isStreamEnabled('logs.app')).toBe(false);
    expect(result.current.isStreamEnabled('logs.nginx')).toBe(true);
  });

  it('persists the allowlist and starts KI extraction when a stream is enabled', async () => {
    const { result } = renderEnabledHook({
      'logs.app': notStarted,
      'logs.nginx': notStarted,
    });

    await act(async () => {
      await result.current.setStreamEnabled('logs.app', true);
    });

    expect(mockSet).toHaveBeenCalledWith(
      OBSERVABILITY_STREAMS_SIGNIFICANT_EVENTS_ENABLED_STREAMS,
      '["logs.app"]'
    );
    expect(mockScheduleOnboarding).toHaveBeenCalledWith(['logs.app']);
    expect(mockCancelOnboarding).not.toHaveBeenCalled();
  });

  it('persists the allowlist and cancels in-flight extraction when a stream is disabled', async () => {
    settingsStore[OBSERVABILITY_STREAMS_SIGNIFICANT_EVENTS_ENABLED_STREAMS] =
      '["logs.app","logs.nginx"]';

    const { result } = renderEnabledHook({
      'logs.app': completed,
      'logs.nginx': completed,
    });

    await act(async () => {
      await result.current.setStreamEnabled('logs.app', false);
    });

    expect(mockSet).toHaveBeenCalledWith(
      OBSERVABILITY_STREAMS_SIGNIFICANT_EVENTS_ENABLED_STREAMS,
      '["logs.nginx"]'
    );
    expect(mockCancelOnboarding).toHaveBeenCalledWith('logs.app');
    expect(mockScheduleOnboarding).not.toHaveBeenCalled();
  });

  it('does not start extraction when persisting enablement fails', async () => {
    mockSet.mockRejectedValueOnce(new Error('save failed'));
    const { result } = renderEnabledHook({
      'logs.app': notStarted,
    });

    await act(async () => {
      await result.current.setStreamEnabled('logs.app', true);
    });

    expect(mockScheduleOnboarding).not.toHaveBeenCalled();
    expect(mockAddError).toHaveBeenCalled();
    expect(result.current.isStreamEnabled('logs.app')).toBe(false);
  });
});
