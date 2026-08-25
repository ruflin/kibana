/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * `findQueries` / `findIndicators` early-return on an empty name list, while
 * `getQueryLinks` treats empty as "all streams". Resolve configured view names
 * (same pattern as `listAllFeaturesRoute`) so search and list stay aligned.
 */
export async function resolveStreamNames(
  streamNames: string[] | undefined,
  listNames: () => Promise<string[]>
): Promise<string[]> {
  if (streamNames?.length) {
    return streamNames;
  }
  return listNames();
}
