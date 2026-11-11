/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { PartialSetupState, ProfilingSetupOptions } from './setup';

const UNIVERSAL_PROFILING_INDEX_PATTERN = 'profiling*';
const EXCLUDE_OTEL_INDEX_PATTERN = '-*.otel-*';

export async function hasProfilingData({
  clientWithProfilingAuth,
}: ProfilingSetupOptions): Promise<PartialSetupState> {
  try {
    // The OTel profiling data streams (`profiling-*.otel-*`) also match `profiling*`,
    // so they are excluded to only report data ingested in the Universal Profiling schema.
    const hasProfilingDataResponse = await clientWithProfilingAuth.esql(
      'has_any_profiling_data',
      esql.from([UNIVERSAL_PROFILING_INDEX_PATTERN, EXCLUDE_OTEL_INDEX_PATTERN]).limit(1)
    );
    return { data: { available: hasProfilingDataResponse.values.length > 0 } };
  } catch (error) {
    // If the indices don't exist or any other error occurs,
    // we assume there's no profiling data available
    return { data: { available: false } };
  }
}
