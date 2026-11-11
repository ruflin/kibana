/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { mapValues, pick } from 'lodash';
import { esql } from '@elastic/esql';
import { unflattenObject } from '@kbn/object-utils';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { Entity } from '@kbn/entity-store/common';
import { ENTITY_LATEST, getEntitiesAlias } from '@kbn/entity-store/server';
import { esqlRows, runEsqlRead } from '../utils/esql_read';

const ENTITY_ID_FIELD = 'entity.id';
const RESOLVED_TO_FIELD = 'entity.relationships.resolution.resolved_to';

/** A search returns at most `index.max_result_window` hits, 10,000 by default: one is the probe. */
const MAX_MEMBERS = 10_000 - 1;

export interface GroupMember {
  id: string;
  /** Holds only the fields asked for. */
  record: Entity;
}

/**
 * The members resolved to each entity, by its id, with the given fields of their records. Ids are read
 * as `fields`, which hold them whether the record stores them nested or as dotted keys.
 */
export const fetchGroupMembers = async (
  esClient: ElasticsearchClient,
  spaceId: string,
  entityIds: readonly string[],
  recordFields: readonly string[] = []
): Promise<Record<string, GroupMember[]>> => {
  if (entityIds.length === 0) return {};
  const withRecords = recordFields.length > 0;
  const filtered = esql.from(
    [getEntitiesAlias(ENTITY_LATEST, spaceId)],
    withRecords ? ['_source'] : []
  ).where`entity.relationships.resolution.resolved_to IN (${{ entityIds: [...entityIds] }})`;
  const response = await runEsqlRead({
    esClient,
    query: (withRecords
      ? filtered.pipe`KEEP entity.id, entity.relationships.resolution.resolved_to, _source`
      : filtered.pipe`KEEP entity.id, entity.relationships.resolution.resolved_to`
    ).limit(MAX_MEMBERS + 1),
    tolerateMissingIndex: true,
  });
  const rows = esqlRows(response);
  if (rows.length > MAX_MEMBERS) {
    throw new Error('The groups of these entities have too many members to read');
  }

  const members: Record<string, GroupMember[]> = {};
  rows.forEach((row) => {
    const id = row[ENTITY_ID_FIELD];
    const headId = row[RESOLVED_TO_FIELD];
    if (typeof id === 'string' && typeof headId === 'string') {
      // The Entity Store can hold fields as dotted keys, such as `asset.criticality`.
      const source = unflattenObject((row._source as object | undefined) ?? {});
      const record = withRecords ? pick(source, recordFields) : {};
      (members[headId] ??= []).push({ id, record: record as Entity });
    }
  });
  return members;
};

export const fetchGroupMemberIds = async (
  esClient: ElasticsearchClient,
  spaceId: string,
  entityIds: readonly string[]
): Promise<Record<string, string[]>> =>
  mapValues(await fetchGroupMembers(esClient, spaceId, entityIds), (members) =>
    members.map(({ id }) => id)
  );
