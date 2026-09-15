/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IUiSettingsClient } from '@kbn/core/public';
import { getEsQueryConfig } from '@kbn/data-plugin/public';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { getESQLResults } from '@kbn/esql-utils';
import type { ISearchGeneric } from '@kbn/search-types';
import { buildEsqlFilter } from '@kbn/streams-plugin/public';

interface ExecuteEsqlParams {
  query: string;
  search: ISearchGeneric;
  signal?: AbortSignal;
  timezone?: string;
  start?: number;
  end?: number;
  uiSettings: IUiSettingsClient;
}

/**
 * Executes an ES|QL query using the data plugin search service.
 * Same client-side path as the Streams list Documents sparkline.
 */
export async function executeEsqlQuery({
  query,
  search,
  signal,
  timezone,
  start,
  end,
  uiSettings,
}: ExecuteEsqlParams): Promise<ESQLSearchResponse> {
  const esQueryConfig = getEsQueryConfig(uiSettings);
  const combinedFilter = buildEsqlFilter({ start, end, esQueryConfig });

  const { response } = await getESQLResults({
    esqlQuery: query,
    search,
    signal,
    filter: combinedFilter,
    timezone,
    timeRange:
      start !== undefined && end !== undefined
        ? {
            from: new Date(start).toISOString(),
            to: new Date(end).toISOString(),
            mode: 'absolute' as const,
          }
        : undefined,
  });

  return response;
}
