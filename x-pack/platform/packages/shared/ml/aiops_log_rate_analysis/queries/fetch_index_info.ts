/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AiopsLogRateAnalysisSchema } from '../api/schema';

import {
  fetchFieldCandidates,
  type FetchFieldCandidatesParams,
  type FetchFieldCandidatesParamsArguments,
} from './fetch_field_candidates';
import { getTotalDocCountRequest } from './get_total_doc_count_request';

// TODO Consolidate with duplicate `fetchPValues` in
// `x-pack/solutions/observability/plugins/apm/server/routes/correlations/queries/fetch_duration_field_candidates.ts`

export interface FetchIndexInfoParamsArguments {
  skipFieldCandidates?: boolean;
}

export interface FetchIndexInfoParams extends FetchFieldCandidatesParams {
  arguments: AiopsLogRateAnalysisSchema &
    FetchFieldCandidatesParamsArguments &
    FetchIndexInfoParamsArguments;
}
export interface FetchIndexInfoResponse {
  keywordFieldCandidates: string[];
  textFieldCandidates: string[];
  baselineTotalDocCount: number;
  deviationTotalDocCount: number;
  zeroDocsFallback: boolean;
}

// ES|QL reports a missing index as a 400 `verification_exception` ("Unknown index"). The
// previous search used `ignore_unavailable: true` and counted no documents for it.
const isUnknownIndexError = (error: unknown): boolean => {
  const { statusCode, body } = error as {
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

const fetchTotalDocCount = async (
  esClient: FetchIndexInfoParams['esClient'],
  request: ReturnType<typeof getTotalDocCountRequest>,
  abortSignal?: AbortSignal
): Promise<number> => {
  try {
    const response = (await esClient.esql.query(request, {
      signal: abortSignal,
      maxRetries: 0,
    })) as unknown as { values: unknown[][] };
    const total = response.values[0]?.[0];
    return typeof total === 'number' ? total : 0;
  } catch (error) {
    if (isUnknownIndexError(error)) return 0;
    throw error;
  }
};

export const fetchIndexInfo = async ({
  esClient,
  abortSignal,
  arguments: args,
}: FetchIndexInfoParams): Promise<FetchIndexInfoResponse> => {
  const { skipFieldCandidates = false, ...fetchFieldCandidatesArguments } = args;
  const { textFieldCandidatesOverrides = [], ...params } = fetchFieldCandidatesArguments;

  // There's a bit of logic involved here because we want to fetch the data
  // in parallel but the call to `fetchFieldCandidates` is optional.

  // #1 First we define the promises that would fetch the data.
  const baselineTotalDocCountPromise = fetchTotalDocCount(
    esClient,
    getTotalDocCountRequest({ ...params, start: params.baselineMin, end: params.baselineMax }),
    abortSignal
  );

  const deviationTotalDocCountPromise = fetchTotalDocCount(
    esClient,
    getTotalDocCountRequest({
      ...params,
      start: params.deviationMin,
      end: params.deviationMax,
    }),
    abortSignal
  );

  const fetchFieldCandidatesPromise = fetchFieldCandidates({
    esClient,
    abortSignal,
    arguments: fetchFieldCandidatesArguments,
  });

  // #2 Then we build an array of these promises. To be able to handle the
  // responses properly we build a tuple based on the types of the promises.
  const promises: [
    typeof baselineTotalDocCountPromise,
    typeof deviationTotalDocCountPromise,
    typeof fetchFieldCandidatesPromise | undefined
  ] = [
    baselineTotalDocCountPromise,
    deviationTotalDocCountPromise,
    !skipFieldCandidates ? fetchFieldCandidatesPromise : undefined,
  ];

  // #3 Finally, we await the promises and return the results.
  const [respBaselineTotalDocCount, respDeviationTotalDocCount, fieldCandidates] =
    await Promise.all(promises);

  const baselineTotalDocCount = respBaselineTotalDocCount;
  const deviationTotalDocCount = respDeviationTotalDocCount;

  return {
    keywordFieldCandidates: fieldCandidates?.selectedKeywordFieldCandidates.sort() ?? [],
    textFieldCandidates: fieldCandidates?.selectedTextFieldCandidates.sort() ?? [],
    baselineTotalDocCount,
    deviationTotalDocCount,
    zeroDocsFallback: baselineTotalDocCount === 0 || deviationTotalDocCount === 0,
  };
};
