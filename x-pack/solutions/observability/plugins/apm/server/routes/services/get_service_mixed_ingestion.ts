/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ServiceMixedIngestionResponse } from '@kbn/apm-api-shared';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import {
  SERVICE_NAME,
  TELEMETRY_SDK_LANGUAGE,
  TELEMETRY_SDK_NAME,
} from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { esqlRows } from '../../lib/helpers/esql_read';
import { toEpochMillis } from '../../lib/helpers/esql_values';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

export async function getServiceMixedIngestion({
  serviceName,
  apmEventClient,
  start,
  end,
  environment,
  kuery,
}: {
  serviceName: string;
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  environment: string;
  kuery: string;
}): Promise<ServiceMixedIngestionResponse> {
  const response = await apmEventClient.esql('get_service_mixed_ingestion', {
    apm: {
      events: [ProcessorEvent.error, ProcessorEvent.transaction, ProcessorEvent.metric],
    },
    // The SDK fields are not mapped in every index, so unmapped fields read as null.
    query: (index) =>
      esql.from(index).addSetCommand('unmapped_fields', 'nullify').pipe`WHERE ${esql.col(
        SERVICE_NAME
      )} == ${{ serviceName }}`.pipe`EVAL ingestion_type = CASE(${esql.col(
        TELEMETRY_SDK_NAME
      )} IS NOT NULL OR ${esql.col(
        TELEMETRY_SDK_LANGUAGE
      )} IS NOT NULL, "otel_native", "classic_apm")`
        .pipe`STATS doc_count = COUNT(*), min_timestamp = MIN(@timestamp), max_timestamp = MAX(@timestamp) BY ingestion_type`.limit(
        2
      ),
    filter: {
      bool: {
        filter: [...rangeQuery(start, end), ...environmentQuery(environment), ...kqlQuery(kuery)],
      },
    },
  });

  const ingestionBuckets = Object.fromEntries(
    esqlRows(response).map((row) => [
      row.ingestion_type as string,
      {
        doc_count: row.doc_count as number,
        min_timestamp: { value: toEpochMillis(row.min_timestamp) },
        max_timestamp: { value: toEpochMillis(row.max_timestamp) },
      },
    ])
  );
  const otelCount = ingestionBuckets.otel_native?.doc_count ?? 0;
  const classicCount = ingestionBuckets.classic_apm?.doc_count ?? 0;
  const hasMultipleAgentTypes = otelCount > 0 && classicCount > 0;

  const classicBucket = ingestionBuckets.classic_apm;
  const otelBucket = ingestionBuckets.otel_native;

  const ingestionTimeRanges = hasMultipleAgentTypes
    ? {
        classicApm: {
          from: classicBucket?.min_timestamp?.value ?? start,
          to: classicBucket?.max_timestamp?.value ?? end,
        },
        otelNative: {
          from: otelBucket?.min_timestamp?.value ?? start,
          to: otelBucket?.max_timestamp?.value ?? end,
        },
      }
    : undefined;

  return {
    hasMultipleAgentTypes,
    ingestionTimeRanges,
  };
}
