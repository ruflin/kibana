/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useMemo } from 'react';
import useObservable from 'react-use/lib/useObservable';
import useAsyncFn from 'react-use/lib/useAsyncFn';
import { i18n } from '@kbn/i18n';
import { useKibana } from './use_kibana';
import { getFormattedError } from '../util/errors';

export interface UseDeveloperModeResult {
  /** Whether developer mode is on for the current user. */
  isDeveloperMode: boolean;
  /** False when the current session has no user profile (anonymous / some proxies). */
  canPersist: boolean;
  isSaving: boolean;
  setDeveloperMode: (enabled: boolean) => Promise<void>;
}

/**
 * Reads/writes Nightshift developer mode from the current user's profile
 * (`userSettings.nightshiftDeveloperMode`), so the preference is per user
 * rather than per Kibana space.
 */
export const useDeveloperMode = (): UseDeveloperModeResult => {
  const { core } = useKibana();
  const { userProfile, notifications } = core;

  const profileData$ = useMemo(() => userProfile.getUserProfile$(), [userProfile]);
  const profileEnabled$ = useMemo(() => userProfile.getEnabled$(), [userProfile]);

  const profileData = useObservable(profileData$, null);
  const isProfileEnabled = useObservable(profileEnabled$, false);

  const isDeveloperMode = profileData?.userSettings?.nightshiftDeveloperMode === true;
  const canPersist = isProfileEnabled === true;

  const [{ loading: isSaving }, setDeveloperMode] = useAsyncFn(
    async (enabled: boolean): Promise<void> => {
      try {
        await userProfile.partialUpdate({
          userSettings: { nightshiftDeveloperMode: enabled },
        });
      } catch (error) {
        notifications.toasts.addDanger({
          title: i18n.translate(
            'xpack.significantEventsApp.settings.developerModeSaveFailedTitle',
            {
              defaultMessage: 'Unable to update developer mode',
            }
          ),
          text: getFormattedError(error).message,
        });
      }
    },
    [notifications.toasts, userProfile]
  );

  return {
    isDeveloperMode,
    canPersist,
    isSaving,
    setDeveloperMode,
  };
};
