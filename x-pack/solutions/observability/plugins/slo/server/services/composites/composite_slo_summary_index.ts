/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { CompositeSLOSummaryDocument } from '@kbn/slo-schema';
import { compositeSloSummaryDocumentSchema } from '@kbn/slo-schema';
import { COMPOSITE_SUMMARY_INDEX_NAME } from '../../../common/constants';
import { runEsqlRows } from '../utils/esql_read';

export type PersistedCompositeSummary = Pick<CompositeSLOSummaryDocument, 'summary' | 'members'>;

export function buildCompositeSloSummaryDocId(spaceId: string, compositeId: string): string {
  return `${spaceId}:${compositeId}`;
}

/**
 * Member summaries used to be persisted with an `id` field; they now use `sloId` to mirror the
 * definition member shape. Normalise legacy docs so they keep decoding until the background task
 * rewrites them.
 *
 * Documents persisted with flat top-level summary fields (the pre-nested-`summary` shape) are not
 * normalised: they fail to decode and are treated as missing until the hourly task rewrites them.
 */
function normalizeLegacyMemberIds(source: unknown): unknown {
  if (typeof source !== 'object' || source === null || !('members' in source)) {
    return source;
  }
  const { members } = source as { members?: unknown };
  if (!Array.isArray(members)) {
    return source;
  }
  const normalizedMembers = members.map((member) => {
    if (typeof member !== 'object' || member === null) {
      return member;
    }
    const { id, sloId, ...rest } = member as Record<string, unknown>;
    return { ...rest, sloId: sloId ?? id };
  });
  return { ...source, members: normalizedMembers };
}

export function mapCompositeSummaryIndexSource(
  source: unknown
): PersistedCompositeSummary | undefined {
  const decoded = compositeSloSummaryDocumentSchema.safeParse(normalizeLegacyMemberIds(source));
  if (!decoded.success) {
    return undefined;
  }
  const { summary, members } = decoded.data;
  return { summary, members };
}

export async function fetchCompositeSloSummariesFromIndex(
  esClient: ElasticsearchClient,
  spaceId: string,
  compositeIds: readonly string[]
): Promise<Map<string, PersistedCompositeSummary>> {
  const result = new Map<string, PersistedCompositeSummary>();
  if (compositeIds.length === 0) {
    return result;
  }

  const docIds = compositeIds.map((id) => buildCompositeSloSummaryDocId(spaceId, id));

  const rows = await runEsqlRows({
    esClient,
    query: esql.from([COMPOSITE_SUMMARY_INDEX_NAME], ['_id', '_source']).pipe`WHERE _id IN (${{
      docIds,
    }}) AND spaceId == ${{ spaceId }}`.limit(compositeIds.length),
  });

  const docIdToCompositeId = new Map(docIds.map((docId, i) => [docId, compositeIds[i]]));

  for (const row of rows) {
    if (!row._source || typeof row._id !== 'string') continue;
    const compositeId = docIdToCompositeId.get(row._id);
    if (!compositeId) continue;
    const persisted = mapCompositeSummaryIndexSource(row._source);
    if (persisted) {
      result.set(compositeId, persisted);
    }
  }

  return result;
}
