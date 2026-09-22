/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { BehaviorSubject } from 'rxjs';
import type { UserProfileData } from '@kbn/core-user-profile-common';
import { useDeveloperMode } from './use_developer_mode';
import { useKibana } from './use_kibana';

jest.mock('./use_kibana', () => ({
  useKibana: jest.fn(),
}));

const mockUseKibana = useKibana as jest.MockedFunction<typeof useKibana>;

describe('useDeveloperMode', () => {
  const partialUpdate = jest.fn().mockResolvedValue(undefined);
  const addDanger = jest.fn();
  let profileData$: BehaviorSubject<UserProfileData | null>;
  let enabled$: BehaviorSubject<boolean>;

  beforeEach(() => {
    jest.clearAllMocks();
    profileData$ = new BehaviorSubject<UserProfileData | null>({
      userSettings: { nightshiftDeveloperMode: false },
    });
    enabled$ = new BehaviorSubject(true);

    mockUseKibana.mockReturnValue({
      core: {
        userProfile: {
          getUserProfile$: () => profileData$.asObservable(),
          getEnabled$: () => enabled$.asObservable(),
          partialUpdate,
        },
        notifications: {
          toasts: { addDanger },
        },
      },
    } as never);
  });

  it('reads nightshiftDeveloperMode from the user profile', () => {
    const { result } = renderHook(() => useDeveloperMode());

    expect(result.current.isDeveloperMode).toBe(false);
    expect(result.current.canPersist).toBe(true);

    act(() => {
      profileData$.next({ userSettings: { nightshiftDeveloperMode: true } });
    });

    expect(result.current.isDeveloperMode).toBe(true);
  });

  it('persists via partialUpdate on the user profile', async () => {
    const { result } = renderHook(() => useDeveloperMode());

    await act(async () => {
      await result.current.setDeveloperMode(true);
    });

    expect(partialUpdate).toHaveBeenCalledWith({
      userSettings: { nightshiftDeveloperMode: true },
    });
  });

  it('disables persistence when the profile is unavailable', () => {
    enabled$.next(false);
    const { result } = renderHook(() => useDeveloperMode());

    expect(result.current.canPersist).toBe(false);
  });

  it('toasts on save failure', async () => {
    partialUpdate.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useDeveloperMode());

    await act(async () => {
      await result.current.setDeveloperMode(true);
    });

    await waitFor(() => {
      expect(addDanger).toHaveBeenCalled();
    });
  });
});
