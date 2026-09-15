/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useCallback } from 'react';
import { useSignificantEventsAppParams } from './use_significant_events_app_params';
import {
  useSignificantEventsAppRouter,
  type StatefulSignificantEventsAppRouter,
} from './use_significant_events_app_router';

export interface ManagementRouteQuery {
  rangeFrom?: string;
  rangeTo?: string;
  search?: string;
  status?: string;
  type?: string | string[];
  subtype?: string | string[];
  stream?: string | string[];
  showComputed?: string;
  selectedItem?: string;
  selectedEvent?: string;
  openEvent?: string;
}

export interface ManagementRouteTarget {
  tab: string;
  subtab?: string;
  query?: ManagementRouteQuery;
}

export interface ManagementRoute {
  tab: string;
  subtab: string | undefined;
  query: ManagementRouteQuery | undefined;
  router: StatefulSignificantEventsAppRouter;
  link: (target: ManagementRouteTarget) => string;
  push: (target: ManagementRouteTarget) => void;
  replace: (target: ManagementRouteTarget) => void;
}

export function useManagementRoute(): ManagementRoute {
  const nested = useSignificantEventsAppParams('/{tab}/{subtab}', true);
  const flat = useSignificantEventsAppParams('/{tab}', true);
  const router = useSignificantEventsAppRouter();

  const tab = nested?.path.tab ?? flat?.path.tab ?? '';
  const subtab = nested?.path.subtab;
  const query = nested?.query ?? flat?.query;

  const link = useCallback(
    (target: ManagementRouteTarget) => {
      const queryParams = target.query ?? {};
      if (target.subtab) {
        return router.link('/{tab}/{subtab}', {
          path: { tab: target.tab, subtab: target.subtab },
          query: queryParams,
        });
      }
      return router.link('/{tab}', {
        path: { tab: target.tab },
        query: queryParams,
      });
    },
    [router]
  );

  const push = useCallback(
    (target: ManagementRouteTarget) => {
      const queryParams = target.query ?? {};
      if (target.subtab) {
        router.push('/{tab}/{subtab}', {
          path: { tab: target.tab, subtab: target.subtab },
          query: queryParams,
        });
        return;
      }
      router.push('/{tab}', {
        path: { tab: target.tab },
        query: queryParams,
      });
    },
    [router]
  );

  const replace = useCallback(
    (target: ManagementRouteTarget) => {
      const queryParams = target.query ?? {};
      if (target.subtab) {
        router.replace('/{tab}/{subtab}', {
          path: { tab: target.tab, subtab: target.subtab },
          query: queryParams,
        });
        return;
      }
      router.replace('/{tab}', {
        path: { tab: target.tab },
        query: queryParams,
      });
    },
    [router]
  );

  return { tab, subtab, query, router, link, push, replace };
}
