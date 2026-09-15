/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useEffect, useRef } from 'react';
import { UI_SETTINGS } from '@kbn/data-plugin/public';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { executeEsqlQuery } from '../util/execute_esql_query';
import {
  buildStreamIngestHistogramEsql,
  getMeaningfulBucketMs,
} from '../util/stream_histogram_esql';
import { useKibana } from './use_kibana';
import { useTimefilter } from './use_timefilter';

/**
 * Default bucket count for ES|QL time histograms (`BUCKET(@timestamp, …)`).
 * Matches the Streams list Documents sparkline so counts stay comparable.
 */
export const STREAMS_HISTOGRAM_NUM_DATA_POINTS = 25;

/**
 * Returns true if the error is an ES|QL "Unknown index" error.
 * This happens when a failure-store backing index does not yet exist — it is created lazily
 * on the first failed document, so an enabled failure store with no failures is normal.
 */
function isUnknownIndexError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes('Unknown index') || error.message.includes('index_not_found_exception')
    );
  }
  return false;
}

/**
 * Fetches per-stream ingest histograms for the Data Sources Documents sparkline.
 * Same ES|QL + time-range path as `useStreamDocCountsFetch` on the Streams page.
 */
export function useStreamHistogramFetch({
  getCanReadFailureStore,
  numDataPoints,
}: {
  getCanReadFailureStore: (streamName: string) => boolean;
  numDataPoints: number;
}): {
  getStreamHistogram(streamName: string): Promise<ESQLSearchResponse>;
} {
  const { timeState, timeState$ } = useTimefilter();
  const {
    dependencies: {
      start: { data },
    },
    core: { uiSettings },
  } = useKibana();

  const histogramPromiseCache = useRef<Partial<Record<string, Promise<ESQLSearchResponse>>>>({});
  const abortControllerRef = useRef<AbortController>();

  if (!abortControllerRef.current) {
    abortControllerRef.current = new AbortController();
  }

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const subscription = timeState$.subscribe({
      next: ({ kind }) => {
        if (kind !== 'initial') {
          histogramPromiseCache.current = {};
          abortControllerRef.current?.abort();
          abortControllerRef.current = new AbortController();
        }
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [timeState$]);

  return {
    getStreamHistogram(streamName: string): Promise<ESQLSearchResponse> {
      const cacheKey = `${streamName}::${timeState.start}::${timeState.end}`;
      const cachedPromise = histogramPromiseCache.current[cacheKey];
      if (cachedPromise) {
        return cachedPromise;
      }

      const abortController = abortControllerRef.current;
      if (!abortController) {
        throw new Error('Abort controller not set');
      }

      const minInterval = getMeaningfulBucketMs(timeState.end - timeState.start, numDataPoints);
      const canReadFailureStore = getCanReadFailureStore(streamName);
      const source = canReadFailureStore ? `${streamName},${streamName}::failures` : streamName;
      const timezone = uiSettings?.get<'Browser' | string>(UI_SETTINGS.DATEFORMAT_TZ);

      const histogramPromise = executeEsqlQuery({
        query: buildStreamIngestHistogramEsql(source, minInterval),
        search: data.search.search,
        timezone,
        signal: abortController.signal,
        start: timeState.start,
        end: timeState.end,
        uiSettings,
      }).catch((error: unknown) => {
        if (isUnknownIndexError(error)) {
          return { columns: [], values: [] };
        }
        throw error;
      });

      histogramPromiseCache.current[cacheKey] = histogramPromise;

      return histogramPromise;
    },
  };
}
