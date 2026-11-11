/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type {
  Signal,
  SignalGroup,
  SignalTag,
  ListSignalGroupsResponse,
  ListSignalsResponse,
} from '../../common/http_api/signals';
import { buildSignalsIndexName } from '../../common/http_api/signals';
import { esqlRows, runEsqlRead } from '../utils/esql_read';

/**
 * Reads run as free functions (rather than via `SignalsService`) because they need the
 * request-scoped `asCurrentUser` client, whereas the service holds a long-lived per-space
 * `asInternalUser` client used by the write path.
 */

/** Options shared by every read so a missing index yields an empty result rather than an error. */
const LENIENT_INDEX_OPTIONS = {
  ignore_unavailable: true,
  allow_no_indices: true,
} as const;

/** Fields never rendered by the UI are excluded from the per-group fetch. */
const SIGNAL_SOURCE_EXCLUDES = ['data.returned.columns'] as const;

/**
 * Preaggregated grouped-by-tag list: one count per distinct value of the multi-valued `tags`
 * keyword field of the current space's signals index, highest count first. A document carrying
 * several tags is counted once under each.
 */
export const getSignalGroups = async (
  esClient: ElasticsearchClient,
  { spaceId, maxGroups }: { spaceId: string; maxGroups: number }
): Promise<ListSignalGroupsResponse> => {
  const response = await runEsqlRead({
    esClient,
    query: esql.from([buildSignalsIndexName(spaceId)]).pipe`WHERE tags IS NOT NULL`
      .pipe`STATS count = COUNT(*) BY tag = tags`.pipe`SORT count DESC, tag ASC`.pipe`LIMIT ${{
      limit: maxGroups,
    }}`,
    // A missing index yields an empty result rather than an error.
    ignoreUnknownIndex: true,
  });

  const groups = esqlRows(response).flatMap((row): SignalGroup[] =>
    typeof row.tag === 'string' && typeof row.count === 'number'
      ? [{ tag: row.tag as SignalTag, count: row.count }]
      : []
  );

  return { groups };
};

/**
 * Fetches the individual signals carrying a given tag from the current space's index, newest first
 * and paginated. The evidence for each signal lives in its flattened `data` object.
 */
export const getSignalsByTag = async (
  esClient: ElasticsearchClient,
  { spaceId, tag, from, size }: { spaceId: string; tag: SignalTag; from: number; size: number }
): Promise<ListSignalsResponse> => {
  const response = await esClient.search<Signal>({
    index: buildSignalsIndexName(spaceId),
    ...LENIENT_INDEX_OPTIONS,
    from,
    size,
    track_total_hits: true,
    _source: { excludes: [...SIGNAL_SOURCE_EXCLUDES] },
    query: {
      bool: {
        filter: [{ term: { tags: tag } }],
      },
    },
    sort: [{ '@timestamp': { order: 'desc' } }],
  });

  const signals = response.hits.hits
    .map((hit) => hit._source)
    .filter((source): source is Signal => source != null);

  const total =
    typeof response.hits.total === 'number'
      ? response.hits.total
      : response.hits.total?.value ?? signals.length;

  return { signals, total };
};
