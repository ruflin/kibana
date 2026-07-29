/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Entity Store POC data hooks. See `constants.ts` in the significant_events server plugin
 * (`server/lib/entity_store_poc`) for why the "Entities" tab talks only to
 * `/internal/significant_events/entity_store_poc/*` and never to the Security Entity
 * Store directly: that plugin is `group: security` / `visibility: private`, so this
 * `streams_app` (`group: platform`) code cannot import it. All state here is
 * proxied through significant_events, which is this POC's R2 "proxy route" answer to
 * that module boundary.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@kbn/react-query';
import { useKibana } from '../../../../../hooks/use_kibana';
import { useFetchErrorToast } from '../../../../../hooks/use_fetch_error_toast';

export interface EntityStorePocRelationship {
  kind: string;
  targetEntityId: string;
  targetServiceName?: string;
}

export interface EntityStorePocEntity {
  id: string;
  name: string;
  type: string;
  source: string[];
  url?: string;
  firstSeen?: string;
  lastSeen?: string;
  relationships: EntityStorePocRelationship[];
}

export interface EntityStorePocAttachment {
  id: string;
  dashboardId: string;
  dashboardTitle: string;
  createdBy?: string;
  createdAt: string;
}

const ENTITY_STORE_POC_QUERY_KEY = 'entityStorePoc';

function useRepositoryClient() {
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();
  return streamsRepositoryClient;
}

export function useFetchEntityStorePocEntities({
  page,
  perPage,
  search,
}: {
  page: number;
  perPage: number;
  search?: string;
}) {
  const client = useRepositoryClient();
  const showFetchErrorToast = useFetchErrorToast();

  return useQuery({
    queryKey: [ENTITY_STORE_POC_QUERY_KEY, 'entities', page, perPage, search],
    queryFn: ({ signal }) =>
      client.fetch('GET /internal/significant_events/entity_store_poc/entities', {
        params: { query: { page, per_page: perPage, search } },
        signal: signal ?? null,
      }),
    onError: showFetchErrorToast,
  });
}

export function useFetchEntityStorePocEntity(entityId: string | undefined) {
  const client = useRepositoryClient();
  const showFetchErrorToast = useFetchErrorToast();

  return useQuery({
    queryKey: [ENTITY_STORE_POC_QUERY_KEY, 'entity', entityId],
    queryFn: ({ signal }) =>
      client.fetch('GET /internal/significant_events/entity_store_poc/entities/{entityId}', {
        params: { path: { entityId: encodeURIComponent(entityId!) } },
        signal: signal ?? null,
      }),
    enabled: !!entityId,
    onError: showFetchErrorToast,
  });
}

export function useFetchEntityStorePocStatus() {
  const client = useRepositoryClient();

  return useQuery({
    queryKey: [ENTITY_STORE_POC_QUERY_KEY, 'status'],
    queryFn: ({ signal }) =>
      client.fetch('GET /internal/significant_events/entity_store_poc/status', {
        signal: signal ?? null,
      }),
    retry: false,
  });
}

export function useFetchEligibleKis() {
  const client = useRepositoryClient();
  const showFetchErrorToast = useFetchErrorToast();

  return useQuery({
    queryKey: [ENTITY_STORE_POC_QUERY_KEY, 'eligibleKis'],
    queryFn: ({ signal }) =>
      client.fetch('GET /internal/significant_events/entity_store_poc/eligible_kis', {
        signal: signal ?? null,
      }),
    onError: showFetchErrorToast,
  });
}

export function useFetchEntityStorePocDashboards() {
  const client = useRepositoryClient();
  const showFetchErrorToast = useFetchErrorToast();

  return useQuery({
    queryKey: [ENTITY_STORE_POC_QUERY_KEY, 'dashboards'],
    queryFn: ({ signal }) =>
      client.fetch('GET /internal/significant_events/entity_store_poc/dashboards', {
        signal: signal ?? null,
      }),
    onError: showFetchErrorToast,
  });
}

function useInvalidateEntityStorePoc() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: [ENTITY_STORE_POC_QUERY_KEY] }),
    [queryClient]
  );
}

export function useInstallEntityStorePocMutation() {
  const client = useRepositoryClient();
  const showFetchErrorToast = useFetchErrorToast();
  const invalidate = useInvalidateEntityStorePoc();

  return useMutation({
    mutationFn: () =>
      client.fetch('POST /internal/significant_events/entity_store_poc/install', {
        signal: null,
      }),
    onError: showFetchErrorToast,
    onSuccess: () => invalidate(),
  });
}

export function usePromoteEntityMutation() {
  const client = useRepositoryClient();
  const showFetchErrorToast = useFetchErrorToast();
  const invalidate = useInvalidateEntityStorePoc();

  return useMutation({
    mutationFn: (body: { serviceName: string; sourceKiId: string; sourceStreamName: string }) =>
      client.fetch('POST /internal/significant_events/entity_store_poc/entities/promote', {
        params: { body },
        signal: null,
      }),
    onError: showFetchErrorToast,
    onSuccess: () => invalidate(),
  });
}

const RELATIONSHIP_KINDS = [
  'depends_on',
  'communicates_with',
  'owns',
  'owns_inferred',
  'administers',
  'supervises',
  'accesses_frequently',
  'accesses_infrequently',
] as const;

export type EntityStorePocRelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export function useAssertRelationshipMutation(entityId: string) {
  const client = useRepositoryClient();
  const showFetchErrorToast = useFetchErrorToast();
  const invalidate = useInvalidateEntityStorePoc();

  return useMutation({
    mutationFn: (body: { kind: EntityStorePocRelationshipKind; targetServiceName: string }) =>
      client.fetch(
        'POST /internal/significant_events/entity_store_poc/entities/{entityId}/relationships',
        {
          params: { path: { entityId: encodeURIComponent(entityId) }, body },
          signal: null,
        }
      ),
    onError: showFetchErrorToast,
    onSuccess: () => invalidate(),
  });
}

export function useAttachDashboardMutation(entityId: string) {
  const client = useRepositoryClient();
  const showFetchErrorToast = useFetchErrorToast();
  const invalidate = useInvalidateEntityStorePoc();

  return useMutation({
    mutationFn: (body: { dashboardId: string; dashboardTitle: string }) =>
      client.fetch(
        'POST /internal/significant_events/entity_store_poc/entities/{entityId}/attachments',
        {
          params: { path: { entityId: encodeURIComponent(entityId) }, body },
          signal: null,
        }
      ),
    onError: showFetchErrorToast,
    onSuccess: () => invalidate(),
  });
}

export function useEntityStorePocPagination(initialPerPage = 25) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(initialPerPage);
  return { page, perPage, setPage, setPerPage };
}
