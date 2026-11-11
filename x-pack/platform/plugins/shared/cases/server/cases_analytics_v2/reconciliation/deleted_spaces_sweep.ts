/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import { esql } from '@elastic/esql';
import type { ElasticsearchClient, Logger, SavedObjectsClientContract } from '@kbn/core/server';
import { DEFAULT_SPACE_ID } from '@kbn/core-spaces-common';
import { ACTIVITY_INDEX_NAME, ATTACHMENTS_INDEX_NAME, CASE_INDEX_NAME } from '../constants';

const ANALYTICS_INDICES = [CASE_INDEX_NAME, ACTIVITY_INDEX_NAME, ATTACHMENTS_INDEX_NAME];
const PAGE_SIZE = 1000;

interface SweepDeletedSpacesArgs {
  esClient: ElasticsearchClient;
  /** Must be created with the hidden `space` type included. */
  savedObjectsClient: SavedObjectsClientContract;
  logger: Logger;
  signal: AbortSignal;
}

/**
 * Deletes analytics docs of deleted spaces. Space deletion removes cases SOs by
 * namespace, bypassing the cases service and its analytics cascade deletes.
 */
export const sweepDeletedSpaces = async ({
  esClient,
  savedObjectsClient,
  logger,
  signal,
}: SweepDeletedSpacesArgs): Promise<void> => {
  // Read indexed ids before existing spaces, so a space created mid-sweep is
  // never mistaken for a deleted one.
  const indexedSpaceIds = await getIndexedSpaceIds(esClient, signal);
  if (indexedSpaceIds.length === 0 || signal.aborted) return;

  const existingSpaceIds = await getExistingSpaceIds(savedObjectsClient);
  if (existingSpaceIds.size === 0) {
    logger.warn('cases-analyticsV2: no spaces found; skipping the deleted-spaces sweep');
    return;
  }

  const deletedSpaceIds = indexedSpaceIds.filter(
    (spaceId) => spaceId !== DEFAULT_SPACE_ID && !existingSpaceIds.has(spaceId)
  );
  if (deletedSpaceIds.length === 0 || signal.aborted) return;

  const { deleted } = await esClient.deleteByQuery({
    index: ANALYTICS_INDICES,
    ignore_unavailable: true,
    conflicts: 'proceed',
    query: { terms: { space_id: deletedSpaceIds } },
  });

  logger.info(
    `cases-analyticsV2: deleted ${deleted} analytics documents of deleted spaces [${deletedSpaceIds.join(
      ', '
    )}]`
  );
};

/** ES|QL reports a missing index as a 400 `verification_exception` ("Unknown index [<name>]"). */
const isUnknownIndexError = (error: unknown): boolean => {
  const { statusCode, body } = (error ?? {}) as {
    statusCode?: number;
    body?: { error?: { type?: string; reason?: string } };
  };
  return (
    statusCode === 400 &&
    body?.error?.type === 'verification_exception' &&
    typeof body.error.reason === 'string' &&
    body.error.reason.includes('Unknown index')
  );
};

/**
 * The distinct `space_id` values of the analytics indices, paged by keyset on `space_id`. Each
 * index is read on its own: ES|QL fails the whole query when one index is missing, where the
 * Query DSL search skipped it, and an index that does not exist yet has no spaces.
 */
const getIndexedSpaceIds = async (
  esClient: ElasticsearchClient,
  signal: AbortSignal
): Promise<string[]> => {
  const spaceIds = new Set<string>();

  for (const index of ANALYTICS_INDICES) {
    let after: string | undefined;
    let pageLength: number;

    do {
      // The composer appends in place, so each page starts from a fresh `FROM`.
      const { query, params } = (after === undefined
        ? esql.from([index]).pipe`WHERE space_id IS NOT NULL`
        : esql.from([index]).pipe`WHERE space_id IS NOT NULL AND space_id > ${{ after }}`
      ).pipe`STATS BY space_id`.pipe`SORT space_id ASC`
        .limit(PAGE_SIZE)
        .toRequest();

      let page: string[];
      try {
        const response = await esClient.esql.query(
          {
            query,
            ...(params && params.length > 0 ? { params } : {}),
          } as unknown as EsqlQueryRequest,
          { signal }
        );
        page = response.values.flatMap(([spaceId]) => (spaceId == null ? [] : [String(spaceId)]));
      } catch (error) {
        if (isUnknownIndexError(error)) break;
        throw error;
      }

      page.forEach((spaceId) => spaceIds.add(spaceId));
      pageLength = page.length;
      after = page[page.length - 1];
    } while (pageLength === PAGE_SIZE && !signal.aborted);
  }

  return [...spaceIds];
};

const getExistingSpaceIds = async (
  savedObjectsClient: SavedObjectsClientContract
): Promise<Set<string>> => {
  const spaceIds = new Set<string>();
  const finder = savedObjectsClient.createPointInTimeFinder({
    type: 'space',
    perPage: PAGE_SIZE,
  });

  try {
    for await (const { saved_objects: spaces } of finder.find()) {
      spaces.forEach(({ id }) => spaceIds.add(id));
    }
  } finally {
    await finder.close();
  }

  return spaceIds;
};
