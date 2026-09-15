/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Data-stream naming-scheme types used by Dataset Quality / Fleet
 * (`{type}-{dataset}-{namespace}`), plus wired stream names (`logs`, `logs.nginx`).
 */
export type DataStreamSignalType = 'logs' | 'metrics' | 'other';

export interface ElasticsearchDataStream {
  readonly name: string;
  readonly type: DataStreamSignalType;
}

interface IndexMatch {
  readonly name: string;
  readonly tags?: ReadonlyArray<{ readonly key: string }>;
}

/** Unquoted ES|QL sources: letters, digits, underscore, dot, and wildcards. Hyphens must be quoted. */
const UNQUOTED_ESQL_SOURCE = /^[a-zA-Z*][a-zA-Z0-9_.*]*$/;

export const classifyDataStreamType = (name: string): DataStreamSignalType => {
  if (name === 'logs' || name.startsWith('logs-') || name.startsWith('logs.')) {
    return 'logs';
  }
  if (name === 'metrics' || name.startsWith('metrics-') || name.startsWith('metrics.')) {
    return 'metrics';
  }
  return 'other';
};

export const isElasticsearchDataStreamMatch = (item: IndexMatch): boolean => {
  if (item.name.startsWith('.')) {
    return false;
  }
  return (item.tags ?? []).some((tag) => tag.key === 'data_stream');
};

export const toElasticsearchDataStreams = (
  items: readonly IndexMatch[]
): ElasticsearchDataStream[] =>
  items
    .filter(isElasticsearchDataStreamMatch)
    .map((item) => ({
      name: item.name,
      type: classifyDataStreamType(item.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

export const quoteEsqlSource = (name: string): string => {
  if (UNQUOTED_ESQL_SOURCE.test(name)) {
    return name;
  }
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

/** Builds a query-stream ES|QL definition that reads the selected data streams. */
export const buildQueryStreamEsqlFromDataStreams = (dataStreamNames: readonly string[]): string => {
  const uniqueSorted = [...new Set(dataStreamNames.filter((name) => name.trim().length > 0))].sort(
    (a, b) => a.localeCompare(b)
  );
  if (uniqueSorted.length === 0) {
    throw new Error('At least one data stream is required');
  }
  return `FROM ${uniqueSorted.map(quoteEsqlSource).join(', ')}`;
};
