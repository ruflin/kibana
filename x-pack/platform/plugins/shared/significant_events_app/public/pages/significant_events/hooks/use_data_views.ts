/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryFunctionContext } from '@kbn/react-query';
import { useMutation, useQuery, useQueryClient } from '@kbn/react-query';
import { i18n } from '@kbn/i18n';
import type { SignificantEventsDataView } from '@kbn/significant-events-schema';
import { useFetchErrorToast } from '../../../hooks/use_fetch_error_toast';
import { useKibana } from '../../../hooks/use_kibana';

export const DATA_VIEWS_QUERY_KEY = ['significantEvents', 'dataViews'] as const;
export const DATA_VIEWS_CATALOG_QUERY_KEY = ['significantEvents', 'dataViews', 'catalog'] as const;

export function useFetchDataViews() {
  const {
    dependencies: {
      start: {
        significantEvents: { significantEventsRepositoryClient },
      },
    },
  } = useKibana();
  const showFetchErrorToast = useFetchErrorToast();

  return useQuery<{ views: SignificantEventsDataView[] }, Error>({
    queryKey: DATA_VIEWS_QUERY_KEY,
    queryFn: async ({ signal }: QueryFunctionContext) =>
      significantEventsRepositoryClient.fetch('GET /internal/significant_events/views', {
        signal: signal ?? null,
      }),
    onError: showFetchErrorToast,
  });
}

export function useFetchDataViewsCatalog(enabled: boolean) {
  const {
    dependencies: {
      start: {
        significantEvents: { significantEventsRepositoryClient },
      },
    },
  } = useKibana();
  const showFetchErrorToast = useFetchErrorToast();

  return useQuery<{ views: Array<{ name: string; query: string }> }, Error>({
    queryKey: DATA_VIEWS_CATALOG_QUERY_KEY,
    enabled,
    queryFn: async ({ signal }: QueryFunctionContext) =>
      significantEventsRepositoryClient.fetch('GET /internal/significant_events/views/_catalog', {
        signal: signal ?? null,
      }),
    onError: showFetchErrorToast,
  });
}

export function useDataViewsApi() {
  const {
    dependencies: {
      start: {
        significantEvents: { significantEventsRepositoryClient },
      },
    },
    core: {
      notifications: { toasts },
    },
  } = useKibana();
  const queryClient = useQueryClient();
  const showFetchErrorToast = useFetchErrorToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: DATA_VIEWS_QUERY_KEY });

  const addExisting = useMutation({
    mutationFn: (name: string) =>
      significantEventsRepositoryClient.fetch('POST /internal/significant_events/views', {
        params: { body: { action: 'add_existing', name } },
        signal: null,
      }),
    onSuccess: () => invalidate(),
    onError: showFetchErrorToast,
  });

  const createOwned = useMutation({
    mutationFn: ({ name, query }: { name: string; query: string }) =>
      significantEventsRepositoryClient.fetch('POST /internal/significant_events/views', {
        params: { body: { action: 'create', name, query } },
        signal: null,
      }),
    onSuccess: () => invalidate(),
    onError: showFetchErrorToast,
  });

  const setEnabled = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      significantEventsRepositoryClient.fetch('PUT /internal/significant_events/views/{name}', {
        params: { path: { name }, body: { enabled } },
        signal: null,
      }),
    onSuccess: () => invalidate(),
    onError: showFetchErrorToast,
  });

  const remove = useMutation({
    mutationFn: (name: string) =>
      significantEventsRepositoryClient.fetch('DELETE /internal/significant_events/views/{name}', {
        params: { path: { name } },
        signal: null,
      }),
    onSuccess: () => {
      invalidate();
      toasts.addSuccess(
        i18n.translate('xpack.significantEventsApp.dataViews.viewRemovedToast', {
          defaultMessage: 'View removed',
        })
      );
    },
    onError: showFetchErrorToast,
  });

  return { addExisting, createOwned, setEnabled, remove };
}
