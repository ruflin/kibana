/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { esql } from '@elastic/esql';
import type { IScopedClusterClient } from '@kbn/core/server';
import { groupBy, keyBy, mapValues } from 'lodash';
import { minimatch } from 'minimatch';
import { esqlRows, runEsqlRead, toEsqlSources } from '../../utils/esql_read';
import { timeRangeFilter, kqlFilter as toKqlFilter } from '../../utils/dsl_filters';
import { parseDatemath } from '../../utils/time';
import { getFieldType } from './get_field_type';

const MAX_KEYWORD_VALUES = 50;
const MAX_TEXT_SAMPLES = 5;
const MAX_CHARS_PER_SAMPLE = 500;

const KEYWORD_TYPES = ['keyword', 'constant_keyword', 'ip'];
const NUMERIC_TYPES = [
  'long',
  'integer',
  'short',
  'byte',
  'double',
  'float',
  'half_float',
  'scaled_float',
  'unsigned_long',
];
const DATE_TYPES = ['date', 'date_nanos'];
const BOOLEAN_TYPES = ['boolean'];
const TEXT_TYPES = ['text', 'match_only_text'];

interface KeywordFieldResult {
  type: 'keyword';
  field: string;
  values: string[];
  hasMoreValues: boolean;
}
interface NumericFieldResult {
  type: 'numeric';
  field: string;
  min: number;
  max: number;
}
interface DateFieldResult {
  type: 'date';
  field: string;
  min: string;
  max: string;
}
interface BooleanFieldResult {
  type: 'boolean';
  field: string;
}
interface TextFieldResult {
  type: 'text';
  field: string;
  samples: string[];
}
interface UnsupportedFieldResult {
  type: 'unsupported';
  field: string;
  fieldType: string;
}
interface FieldErrorResult {
  type: 'error';
  field: string;
  message: string;
}

export interface FieldValuesRecordResult {
  fields: Record<
    string,
    | KeywordFieldResult
    | NumericFieldResult
    | DateFieldResult
    | BooleanFieldResult
    | TextFieldResult
    | UnsupportedFieldResult
    | FieldErrorResult
  >;
}

/** Gets distinct values for a single keyword field via termsEnum with optional filtering */
async function getKeywordFieldValues(
  esClient: IScopedClusterClient,
  index: string,
  field: string,
  queryFilter?: QueryDslQueryContainer
): Promise<KeywordFieldResult | FieldErrorResult> {
  try {
    const { terms } = await esClient.asCurrentUser.termsEnum({
      index,
      field,
      size: MAX_KEYWORD_VALUES + 1,
      index_filter: queryFilter,
    });

    return {
      type: 'keyword',
      field,
      values: terms.slice(0, MAX_KEYWORD_VALUES),
      hasMoreValues: terms.length > MAX_KEYWORD_VALUES,
    };
  } catch (error) {
    return { type: 'error', field, message: error.message };
  }
}

/** `min_<i> = MIN(field), max_<i> = MAX(field)` for each field, read back by position. */
const toMinMaxAggregations = (fields: string[]) =>
  fields.flatMap((field, i) => [
    esql.exp`${esql.col(`min_${i}`)} = MIN(${esql.col(field)})`,
    esql.exp`${esql.col(`max_${i}`)} = MAX(${esql.col(field)})`,
  ]);

/** Gets min/max for multiple numeric fields in a single request */
async function getNumericFieldValuesBatch(
  esClient: IScopedClusterClient,
  index: string,
  fields: string[],
  queryFilter?: QueryDslQueryContainer
): Promise<Record<string, NumericFieldResult | FieldErrorResult>> {
  if (fields.length === 0) return {};

  const response = await runEsqlRead({
    esClient: esClient.asCurrentUser,
    query: esql.from(toEsqlSources(index)).pipe`STATS ${toMinMaxAggregations(fields)}`,
    filter: queryFilter,
  });
  const row = esqlRows(response)[0] ?? {};

  return keyBy(
    fields.map((field, i): NumericFieldResult | FieldErrorResult => {
      const min = row[`min_${i}`];
      const max = row[`max_${i}`];
      if (typeof min === 'number' && typeof max === 'number') {
        return { type: 'numeric', field, min, max };
      }
      return { type: 'error', field, message: 'No numeric values found' };
    }),
    'field'
  );
}

/** Gets min/max for multiple date fields in a single request */
async function getDateFieldValuesBatch(
  esClient: IScopedClusterClient,
  index: string,
  fields: string[],
  queryFilter?: QueryDslQueryContainer
): Promise<Record<string, DateFieldResult | FieldErrorResult>> {
  if (fields.length === 0) return {};

  const response = await runEsqlRead({
    esClient: esClient.asCurrentUser,
    query: esql.from(toEsqlSources(index)).pipe`STATS ${toMinMaxAggregations(fields)}`,
    filter: queryFilter,
  });
  const row = esqlRows(response)[0] ?? {};

  return keyBy(
    fields.map((field, i): DateFieldResult | FieldErrorResult => {
      const min = row[`min_${i}`];
      const max = row[`max_${i}`];
      if (typeof min === 'string' && typeof max === 'string') {
        return { type: 'date', field, min, max };
      }
      return { type: 'error', field, message: 'No date values found' };
    }),
    'field'
  );
}

/** Gets sample values for multiple text fields in a single request */
async function getTextFieldSampleValues(
  esClient: IScopedClusterClient,
  index: string,
  fields: string[],
  queryFilter?: QueryDslQueryContainer
): Promise<Record<string, TextFieldResult | FieldErrorResult>> {
  if (fields.length === 0) return {};
  const [firstField, ...otherFields] = fields;

  const response = await runEsqlRead({
    esClient: esClient.asCurrentUser,
    query: esql
      .from(toEsqlSources(index))
      .keep(firstField, ...otherFields)
      .limit(MAX_TEXT_SAMPLES),
    filter: queryFilter,
  });
  const rows = esqlRows(response);

  return Object.fromEntries(
    fields.map((field): [string, TextFieldResult | FieldErrorResult] => {
      const samples = rows
        .flatMap((row) => row[field] ?? [])
        .filter((v): v is string => typeof v === 'string')
        .slice(0, MAX_TEXT_SAMPLES)
        .map((v) => (v.length > MAX_CHARS_PER_SAMPLE ? v.slice(0, MAX_CHARS_PER_SAMPLE) + '…' : v));

      if (samples.length === 0) {
        return [field, { type: 'error', field, message: 'No text values found' }];
      }
      return [field, { type: 'text', field, samples }];
    })
  );
}

/** Determines the category for a field type */
export function getFieldCategory(
  fieldType: string
): 'keyword' | 'numeric' | 'date' | 'boolean' | 'text' | 'unsupported' {
  if (KEYWORD_TYPES.includes(fieldType)) return 'keyword';
  if (NUMERIC_TYPES.includes(fieldType)) return 'numeric';
  if (DATE_TYPES.includes(fieldType)) return 'date';
  if (BOOLEAN_TYPES.includes(fieldType)) return 'boolean';
  if (TEXT_TYPES.includes(fieldType)) return 'text';
  return 'unsupported';
}

export interface ResolvedValidField {
  field: string;
  fieldType: string;
  category: ReturnType<typeof getFieldCategory>;
}
interface ResolvedErrorField {
  input: string;
  error: string;
}
export type ResolvedField = ResolvedValidField | ResolvedErrorField;

/** Resolves an input (field name or wildcard) to concrete fields or an error */
export function resolveInputToConcreteFields(
  input: string,
  allFieldNames: string[],
  fieldNameToTypeMap: Record<string, string | undefined>
): ResolvedField[] {
  const isWildcard = input.includes('*');
  if (!isWildcard) {
    const fieldType = fieldNameToTypeMap[input];
    if (fieldType) {
      return [{ field: input, fieldType, category: getFieldCategory(fieldType) }];
    }
    return [{ input, error: `Field "${input}" not found` }];
  }

  const matchingFields = allFieldNames.filter(
    (f) => minimatch(f, input, { dot: true }) && fieldNameToTypeMap[f]
  );

  if (matchingFields.length === 0) {
    return [{ input, error: `No fields match pattern "${input}"` }];
  }

  return matchingFields.map((field) => ({
    field,
    fieldType: fieldNameToTypeMap[field]!,
    category: getFieldCategory(fieldNameToTypeMap[field]!),
  }));
}

/**
 * Field value discovery - returns values/ranges for multiple fields.
 * Batches requests by field type to minimize ES calls.
 * Supports wildcard patterns in field names (e.g., "attributes.*").
 */
export async function getFieldValuesHandler({
  esClient,
  index,
  fields,
  start,
  end,
  kqlFilter,
}: {
  esClient: IScopedClusterClient;
  index: string;
  fields: string[];
  start: string;
  end: string;
  kqlFilter?: string;
}): Promise<FieldValuesRecordResult> {
  const queryFilter = {
    bool: {
      filter: [
        ...timeRangeFilter('@timestamp', {
          start: parseDatemath(start),
          end: parseDatemath(end, { roundUp: true }),
        }),
        ...toKqlFilter(kqlFilter),
      ],
    },
  };

  // fieldCaps expands wildcards and returns field types
  // Note: also returns parent object fields from passthrough types (filtered out below)
  const capsResponse = await esClient.asCurrentUser.fieldCaps({
    index,
    fields,
    ignore_unavailable: true,
    allow_no_indices: true,
    index_filter: queryFilter,
  });

  // Map field names to their concrete types (undefined for object/nested/unmapped)
  const fieldNameToTypeMap = mapValues(capsResponse.fields, getFieldType);
  const allFieldNames = Object.keys(fieldNameToTypeMap);

  // Resolve all inputs to concrete fields or errors
  const concreteFields = fields.flatMap((input) =>
    resolveInputToConcreteFields(input, allFieldNames, fieldNameToTypeMap)
  );
  const errors = concreteFields.filter((r): r is ResolvedErrorField => 'error' in r);
  const validFields = concreteFields.filter((r): r is ResolvedValidField => 'field' in r);

  // Group valid fields by category
  const byCategory = groupBy(validFields, (r) => r.category);
  const keywordFields = (byCategory.keyword ?? []).map((r) => r.field);
  const numericFields = (byCategory.numeric ?? []).map((r) => r.field);
  const dateFields = (byCategory.date ?? []).map((r) => r.field);
  const booleanFields = (byCategory.boolean ?? []).map((r) => r.field);
  const textFields = (byCategory.text ?? []).map((r) => r.field);
  const unsupportedFields = byCategory.unsupported ?? [];

  // Fetch values in parallel by type
  const [keywordResults, numericResults, dateResults, textResults] = await Promise.all([
    Promise.all(keywordFields.map((f) => getKeywordFieldValues(esClient, index, f, queryFilter))),
    getNumericFieldValuesBatch(esClient, index, numericFields, queryFilter),
    getDateFieldValuesBatch(esClient, index, dateFields, queryFilter),
    getTextFieldSampleValues(esClient, index, textFields, queryFilter),
  ]);

  const errorResults = Object.fromEntries(
    errors.map((e) => [e.input, { type: 'error' as const, field: e.input, message: e.error }])
  );
  const unsupportedResults = Object.fromEntries(
    unsupportedFields.map((r) => [
      r.field,
      { type: 'unsupported' as const, field: r.field, fieldType: r.fieldType },
    ])
  );
  const booleanResults = Object.fromEntries(
    booleanFields.map((f) => [f, { type: 'boolean' as const, field: f }])
  );

  return {
    fields: {
      ...errorResults,
      ...unsupportedResults,
      ...booleanResults,
      ...keyBy(keywordResults, 'field'),
      ...numericResults,
      ...dateResults,
      ...textResults,
    },
  };
}
