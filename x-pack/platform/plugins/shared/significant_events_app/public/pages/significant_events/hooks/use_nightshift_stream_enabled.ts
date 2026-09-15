/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useCallback, useMemo, useState } from 'react';
import { i18n } from '@kbn/i18n';
import { OBSERVABILITY_STREAMS_SIGNIFICANT_EVENTS_ENABLED_STREAMS } from '@kbn/management-settings-ids';
import {
  parseEnabledStreamsSetting,
  serializeEnabledStreamsSetting,
} from '@kbn/significant-events-plugin/common';
import {
  isKiOnboardingEnabledStatus,
  type SignificantEventsWorkflowStatusResult,
} from '@kbn/significant-events-schema';
import { useKibana } from '../../../hooks/use_kibana';
import { getFormattedError } from '../../../util/errors';

const ENABLE_STREAM_ERROR_TITLE = i18n.translate(
  'xpack.significantEventsApp.streamsView.enableStreamErrorTitle',
  { defaultMessage: 'Could not enable stream' }
);

const DISABLE_STREAM_ERROR_TITLE = i18n.translate(
  'xpack.significantEventsApp.streamsView.disableStreamErrorTitle',
  { defaultMessage: 'Could not disable stream' }
);

const seedEnabledStreamNames = ({
  knownStreamNames,
  streamStatusMap,
}: {
  knownStreamNames: readonly string[];
  streamStatusMap: Record<string, SignificantEventsWorkflowStatusResult>;
}): string[] =>
  knownStreamNames.filter((streamName) => {
    const status = streamStatusMap[streamName]?.status;
    return status !== undefined && isKiOnboardingEnabledStatus(status);
  });

export function useNightshiftStreamEnabled({
  knownStreamNames,
  streamStatusMap,
  scheduleOnboarding,
  cancelOnboarding,
}: {
  knownStreamNames: readonly string[];
  streamStatusMap: Record<string, SignificantEventsWorkflowStatusResult>;
  scheduleOnboarding: (streamNames: string[]) => Promise<string[]>;
  cancelOnboarding: (streamName: string) => Promise<void>;
}) {
  const {
    core: {
      settings: { client: settingsClient },
      notifications: { toasts },
    },
  } = useKibana();

  const persistedRawValue = settingsClient.get<string>(
    OBSERVABILITY_STREAMS_SIGNIFICANT_EVENTS_ENABLED_STREAMS,
    ''
  );
  const persistedSetting = useMemo(
    () => parseEnabledStreamsSetting(persistedRawValue),
    [persistedRawValue]
  );
  const [draftAllowlist, setDraftAllowlist] = useState<string[] | undefined>();
  const [pendingStreamNames, setPendingStreamNames] = useState<Set<string>>(() => new Set());

  const effectiveAllowlist = useMemo(() => {
    if (draftAllowlist !== undefined) {
      return { configured: true as const, streamNames: draftAllowlist };
    }
    if (persistedSetting.configured) {
      return persistedSetting;
    }
    return {
      configured: false as const,
      streamNames: seedEnabledStreamNames({ knownStreamNames, streamStatusMap }),
    };
  }, [draftAllowlist, persistedSetting, knownStreamNames, streamStatusMap]);

  const enabledStreamNames = useMemo(
    () => new Set(effectiveAllowlist.streamNames),
    [effectiveAllowlist.streamNames]
  );

  const isStreamEnabled = useCallback(
    (streamName: string) => enabledStreamNames.has(streamName),
    [enabledStreamNames]
  );

  const isStreamTogglePending = useCallback(
    (streamName: string) => pendingStreamNames.has(streamName),
    [pendingStreamNames]
  );

  const setStreamEnabled = useCallback(
    async (streamName: string, enabled: boolean) => {
      const currentNames = effectiveAllowlist.configured
        ? effectiveAllowlist.streamNames
        : seedEnabledStreamNames({ knownStreamNames, streamStatusMap });
      const nextNames = enabled
        ? [...new Set([...currentNames, streamName])]
        : currentNames.filter((name) => name !== streamName);

      setDraftAllowlist(nextNames);
      setPendingStreamNames((current) => new Set([...current, streamName]));

      try {
        await settingsClient.set(
          OBSERVABILITY_STREAMS_SIGNIFICANT_EVENTS_ENABLED_STREAMS,
          serializeEnabledStreamsSetting(nextNames)
        );
        setDraftAllowlist(undefined);
      } catch (error) {
        setDraftAllowlist(undefined);
        toasts.addError(getFormattedError(error), {
          title: enabled ? ENABLE_STREAM_ERROR_TITLE : DISABLE_STREAM_ERROR_TITLE,
        });
        setPendingStreamNames((current) => {
          const next = new Set(current);
          next.delete(streamName);
          return next;
        });
        return;
      }

      try {
        if (enabled) {
          await scheduleOnboarding([streamName]);
        } else {
          await cancelOnboarding(streamName);
        }
      } catch (error) {
        if (!enabled) {
          toasts.addError(getFormattedError(error), {
            title: DISABLE_STREAM_ERROR_TITLE,
          });
        }
      } finally {
        setPendingStreamNames((current) => {
          const next = new Set(current);
          next.delete(streamName);
          return next;
        });
      }
    },
    [
      cancelOnboarding,
      effectiveAllowlist.configured,
      effectiveAllowlist.streamNames,
      knownStreamNames,
      scheduleOnboarding,
      settingsClient,
      streamStatusMap,
      toasts,
    ]
  );

  return {
    isStreamEnabled,
    isStreamTogglePending,
    setStreamEnabled,
  };
}
