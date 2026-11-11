/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { TracedElasticsearchClient } from '@kbn/traced-es-client';
import { kqlQuery } from '../../es/queries/kql_query';

type SloSummarySource = Record<string, any> & {
  status: 'VIOLATED' | 'DEGRADED' | 'HEALTHY' | 'NO_DATA';
};

/** ES|QL fails on a pattern without matching indices, where the DSL search returned no hits. */
const isUnknownIndexError = (error: unknown) => {
  const candidate = error as
    | { statusCode?: number; body?: { error?: { type?: string; reason?: string } } }
    | undefined;
  return (
    candidate?.statusCode === 400 &&
    candidate.body?.error?.type === 'verification_exception' &&
    candidate.body.error.reason?.includes('Unknown index') === true
  );
};

export async function getSlosForEntity({
  start,
  end,
  entity,
  esClient,
  sloSummaryIndices,
  size,
  spaceId,
}: {
  start: number;
  end: number;
  entity: Record<string, unknown>;
  esClient: TracedElasticsearchClient;
  sloSummaryIndices: string | string[];
  size: number;
  spaceId: string;
}) {
  const slosKuery = Object.entries(entity)
    .map(([field, value]) => {
      return `(slo.groupings.${field}:"${value}")`;
    })
    .join(' AND ');

  const sources = (
    Array.isArray(sloSummaryIndices) ? sloSummaryIndices : sloSummaryIndices.split(',')
  )
    .map((source) => source.trim())
    .filter((source) => source.length > 0);

  // `slo.groupings` is a flattened field, so the KQL stays Query DSL in the request filter.
  const { filter: _composerFilter, ...request } = esql.from(sources, ['_id', '_source'])
    .pipe`WHERE slo.createdAt <= TO_DATETIME(${{ end }}) AND summaryUpdatedAt >= TO_DATETIME(${{
    start,
  }}) AND spaceId == ${{ spaceId }}`
    .limit(size)
    .toRequest();

  try {
    const { hits } = await esClient.esql(
      'get_slo_summaries_for_entity',
      { ...request, filter: { bool: { filter: kqlQuery(slosKuery) } } } as Parameters<
        TracedElasticsearchClient['esql']
      >[1],
      { transform: 'plain' }
    );

    return {
      hits: {
        hits: hits.map((hit) => ({
          _id: String(hit._id),
          // `_source` is returned by ES|QL as a JSON object, typed as a generic scalar value
          _source: hit._source as unknown as SloSummarySource,
        })),
      },
    };
  } catch (error) {
    if (isUnknownIndexError(error)) {
      return { hits: { hits: [] as Array<{ _id: string; _source: SloSummarySource }> } };
    }
    throw error;
  }
}
