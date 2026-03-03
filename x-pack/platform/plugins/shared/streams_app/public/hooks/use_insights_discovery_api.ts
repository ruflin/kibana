/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useAbortController } from '@kbn/react-hooks';
import { useMemo } from 'react';
import { useKibana } from './use_kibana';

export function useDiscoveryPipelineApi(connectorId?: string) {
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
      scheduleDiscoveryPipelineTask: async (streamNames?: string[]) => {
        await streamsRepositoryClient.fetch('POST /internal/streams/_discovery/_task', {
          signal,
          params: {
            body: {
              action: 'schedule',
              connectorId,
              ...(streamNames && streamNames.length > 0 ? { streamNames } : {}),
            },
          },
        });
      },
      getDiscoveryPipelineTaskStatus: async () => {
        return streamsRepositoryClient.fetch('POST /internal/streams/_discovery/_status', {
          signal,
        });
      },
      cancelDiscoveryPipelineTask: async () => {
        return streamsRepositoryClient.fetch('POST /internal/streams/_discovery/_task', {
          signal,
          params: {
            body: {
              action: 'cancel' as const,
            },
          },
        });
      },
      acknowledgeDiscoveryPipelineTask: async () => {
        return streamsRepositoryClient.fetch('POST /internal/streams/_discovery/_task', {
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
