/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { PROFILING_EVENTS_INDEX_BY_SCHEMA, ProfilingSchema } from '@kbn/profiling-utils';
import type { ProfilingESClient } from '../../../utils/profiling_es_client';

export async function hasOtelProfilingData({
  client,
}: {
  client: ProfilingESClient;
}): Promise<boolean> {
  // Only existence matters (the DSL search used `terminate_after: 1`), so one row is enough. A
  // missing index yields an empty response.
  const response = await client.esql(
    'has_any_otel_profiling_data',
    esql.from([PROFILING_EVENTS_INDEX_BY_SCHEMA[ProfilingSchema.OTEL]]).limit(1)
  );

  return response.values.length > 0;
}
