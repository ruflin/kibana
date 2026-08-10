/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useCallback } from 'react';
import { type QueryFunctionContext, useQuery } from '@kbn/react-query';
import type {
  SignificantEventsStatsInterval,
  SignificantEventsStatsResponse,
} from '@kbn/significant-events-plugin/common';
import { useKibana } from './use_kibana';
import { useFetchErrorToast } from './use_fetch_error_toast';

interface UseFetchStatsParams {
  from: string | number;
  to: string | number;
  interval?: SignificantEventsStatsInterval;
}

export const useFetchStats = ({ from, to, interval = '1d' }: UseFetchStatsParams) => {
  const {
    dependencies: {
      start: {
        significantEvents: { significantEventsRepositoryClient },
      },
    },
  } = useKibana();
  const showFetchErrorToast = useFetchErrorToast();

  const fetchStats = useCallback(
    async ({ signal }: QueryFunctionContext): Promise<SignificantEventsStatsResponse> => {
      return significantEventsRepositoryClient.fetch('GET /internal/significant_events/stats', {
        params: {
          query: {
            from: new Date(from).toISOString(),
            to: new Date(to).toISOString(),
            interval,
          },
        },
        signal: signal ?? null,
      });
    },
    [significantEventsRepositoryClient, from, to, interval]
  );

  return useQuery<SignificantEventsStatsResponse, Error>({
    queryKey: ['significantEventsStats', from, to, interval],
    queryFn: fetchStats,
    onError: showFetchErrorToast,
  });
};
