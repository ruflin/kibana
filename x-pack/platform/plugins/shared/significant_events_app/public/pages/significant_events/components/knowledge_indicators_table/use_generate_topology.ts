/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useMutation, useQueryClient } from '@kbn/react-query';
import { useKibana } from '../../../../hooks/use_kibana';
import { getFormattedError } from '../../../../util/errors';
import { FEATURES_QUERY_KEY } from '../../../../hooks/use_fetch_features';
import { GENERATE_TOPOLOGY_ERROR_TITLE } from './translations';

export const GENERATE_TOPOLOGY_MUTATION_KEY = ['generateTopology'] as const;

export interface GenerateTopologyResult {
  streamNames: string[];
  createdCount: number;
  connectorId: string;
}

export function useGenerateTopology() {
  const { significantEventsRepositoryClient } = useKibana().dependencies.start.significantEvents;
  const {
    core: {
      notifications: { toasts },
    },
  } = useKibana();
  const queryClient = useQueryClient();

  const mutation = useMutation<GenerateTopologyResult, Error, string[]>({
    mutationKey: [...GENERATE_TOPOLOGY_MUTATION_KEY],
    mutationFn: async (streamNames) => {
      return significantEventsRepositoryClient.fetch(
        'POST /internal/streams/knowledge_indicators/topology/_generate',
        {
          signal: null,
          params: {
            body: { streamNames },
          },
        }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: FEATURES_QUERY_KEY });
    },
    onError: (error) => {
      toasts.addError(getFormattedError(error), { title: GENERATE_TOPOLOGY_ERROR_TITLE });
    },
  });

  return {
    generateTopology: (streamNames: string[]) => mutation.mutateAsync(streamNames),
    isGenerating: mutation.isLoading,
    error: mutation.error,
    reset: mutation.reset,
  };
}
