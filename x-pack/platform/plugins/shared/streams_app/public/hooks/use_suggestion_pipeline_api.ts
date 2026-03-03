/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useAbortController } from '@kbn/react-hooks';
import { useMemo } from 'react';
import { useKibana } from './use_kibana';

export function useSuggestionPipelineApi(connectorId?: string) {
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();

  const { signal } = useAbortController();

  return useMemo(
    () => ({
      scheduleSuggestionTask: async () => {
        await streamsRepositoryClient.fetch('POST /internal/streams/_suggestions/_task', {
          signal,
          params: {
            body: {
              action: 'schedule',
              connectorId,
            },
          },
        });
      },
      getSuggestionTaskStatus: async () => {
        return streamsRepositoryClient.fetch('POST /internal/streams/_suggestions/_status', {
          signal,
        });
      },
      cancelSuggestionTask: async () => {
        return streamsRepositoryClient.fetch('POST /internal/streams/_suggestions/_task', {
          signal,
          params: {
            body: {
              action: 'cancel' as const,
            },
          },
        });
      },
      acknowledgeSuggestionTask: async () => {
        return streamsRepositoryClient.fetch('POST /internal/streams/_suggestions/_task', {
          signal,
          params: {
            body: {
              action: 'acknowledge' as const,
            },
          },
        });
      },
    }),
    [connectorId, signal, streamsRepositoryClient]
  );
}
