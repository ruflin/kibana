/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { forEach, keys, sortBy, reduce, size } from 'lodash';
import { flatMap, flow, groupBy, values as valuesFP, map, pickBy } from 'lodash/fp';

import type { IScopedClusterClient } from '@kbn/core/server';
import type { FieldCapsResponse } from '@elastic/elasticsearch/lib/api/types';

import { quoteEsqlIndexName } from '../../../lib/quote_esql_index_name';

export type FieldCapsList = FieldCapsResponse['fields'];

const normalizedFieldTypes: { [key: string]: string } = {
  long: 'number',
  integer: 'number',
  short: 'number',
  byte: 'number',
  double: 'number',
  float: 'number',
  half_float: 'number',
  scaled_float: 'number',
  unsigned_long: 'number',
};

interface FieldItem {
  name: string;
  type: string;
  normalizedType: string;
}

interface FieldsPerIndexType {
  index: string;
  fields: FieldItem[];
}

/** ES|QL reports a missing concrete index or an unmatched pattern as a 400 `verification_exception`. */
const isEsqlUnknownIndexError = (error: unknown): boolean => {
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

export function getCommonFields(fieldsPerIndex: FieldsPerIndexType[]) {
  return flow(
    // Flatten the fields arrays
    flatMap('fields'),
    // Group fields by name
    groupBy('name'),
    // Keep groups with more than 1 field
    pickBy((group) => group.length > 1),
    // Convert the result object to an array of fields
    valuesFP,
    // Take the first item from each group (since we only need one match)
    map((group) => group[0])
  )(fieldsPerIndex);
}

export function normalizeFieldsList(fields: FieldCapsList) {
  const result: FieldItem[] = [];

  forEach(fields, (field, name) => {
    // If the field exists in multiple indexes, the types may be inconsistent.
    // In this case, default to the first type.
    const type = keys(field)[0];

    // Do not include fields that have a type that starts with an underscore (e.g. _id, _source)
    if (type.startsWith('_')) {
      return;
    }

    result.push({
      name,
      type,
      normalizedType: normalizedFieldTypes[type] || type,
    });
  });

  return sortBy(result, 'name');
}

export function getIndexNamesFromAliasesResponse(json: Record<string, any>) {
  return reduce(
    json,
    (list, { aliases }, indexName) => {
      // Add the index name to the list
      list.push(indexName);
      // If the index has aliases, add them to the list as well
      if (size(aliases) > 0) {
        list.push(...Object.keys(aliases));
      }

      return list;
    },
    [] as string[]
  );
}

export async function getIndices(dataClient: IScopedClusterClient, pattern: string, limit = 10) {
  // We will first rely on the indices aliases API to get the list of indices and their aliases.
  const aliasResult = await dataClient.asCurrentUser.indices.getAlias(
    {
      index: pattern,
      expand_wildcards: 'open',
    },
    {
      ignore: [404],
      meta: true,
    }
  );

  if (aliasResult.statusCode !== 404) {
    const indicesFromAliasResponse = getIndexNamesFromAliasesResponse(aliasResult.body);
    return indicesFromAliasResponse.slice(0, limit);
  }

  // If the indices aliases API fails or returns nothing, we will rely on the indices stats API to
  // get the list of indices.
  // Source names are quoted and escaped: a comma separates the patterns, as it did for the `index` of
  // the search request. A pattern without any match fails with an `Unknown index` verification error
  // in ES|QL, where the search request returned no hits.
  const sources = pattern
    .split(',')
    .map((source) => source.trim())
    .filter((source) => source.length > 0)
    .map(quoteEsqlIndexName);

  if (sources.length === 0) {
    return [];
  }

  try {
    const response = await dataClient.asCurrentUser.esql.query({
      query: `FROM ${sources.join(
        ', '
      )} METADATA _index | STATS doc_count = COUNT(*) BY _index | SORT doc_count DESC, _index ASC | LIMIT ${Math.trunc(
        limit
      )}`,
    });

    const indexColumn = response.columns.findIndex((column) => column.name === '_index');
    return (response.values ?? []).map((row) => row[indexColumn] as string);
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) {
      return [];
    }
    throw error;
  }
}

export async function getDataStreams(
  dataClient: IScopedClusterClient,
  pattern: string,
  limit = 10
) {
  const response = await dataClient.asCurrentUser.indices.getDataStream({
    name: pattern,
    expand_wildcards: 'open',
  });

  return response.data_streams ? response.data_streams.map((dataStream) => dataStream.name) : [];
}
