/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Quotes an ES|QL source identifier. Backticks inside the name are doubled.
 */
export const quoteEsqlSource = (name: string): string => `\`${name.replace(/`/g, '``')}\``;

/**
 * Builds `FROM \`a\`, \`b\`` from data stream names. Callers must pass a
 * non-empty, already-validated list.
 */
export const toFromQuery = (dataStreams: string[]): string => {
  if (dataStreams.length === 0) {
    throw new Error('At least one data stream is required');
  }
  return `FROM ${dataStreams.map(quoteEsqlSource).join(', ')}`;
};
