/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { rangeQuery } from '@kbn/observability-utils-common/es/queries/range_query';
import { termQuery } from '@kbn/observability-utils-common/es/queries/term_query';
import {
  AGENT_NAME,
  HOST_HOSTNAME,
  HOST_NAME,
  METRICSET_NAME,
  SERVICE_NAME,
} from '@kbn/apm-types/es_fields';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { esql } from '@elastic/esql';
import type { ESQLSearchResponse } from '@kbn/es-types';
import type { TimeRangeMetadata } from '../../../common';
import {
  RollupInterval,
  getBucketSize,
  getPreferredBucketSizeAndDataSource,
} from '../../../common';
import { ApmDocumentType } from '../../../common/document_type';
import type { ApmDataAccessServicesParams } from '../get_services';

const MAX_SIZE = 1000;

export interface HostServicesRequest {
  filters: Record<string, string>;
  start: number;
  end: number;
  size?: number;
  documentSources: TimeRangeMetadata['sources'];
}

const suitableTypes = [ApmDocumentType.TransactionMetric, ApmDocumentType.ErrorEvent];

/** The services of a response with the timestamp and the agent name of their latest document. */
function toServices(response: ESQLSearchResponse | undefined) {
  if (!response) {
    return [];
  }
  const column = (name: string) => response.columns.findIndex((col) => col.name === name);
  const serviceNameIndex = column(SERVICE_NAME);
  const latestTimestampIndex = column('latest_timestamp');
  const agentNameIndex = column('agent_name');

  return response.values.map((row) => ({
    serviceName: row[serviceNameIndex] as string,
    latestTimestamp: row[latestTimestampIndex] as string,
    agentName: (row[agentNameIndex] as string | null) ?? null,
  }));
}

export function createGetHostServices({ apmEventClient }: ApmDataAccessServicesParams) {
  return async ({ start, end, size = MAX_SIZE, filters, documentSources }: HostServicesRequest) => {
    const sourcesToUse = getPreferredBucketSizeAndDataSource({
      sources: documentSources.filter((s) => suitableTypes.includes(s.documentType)),
      bucketSizeInSeconds: getBucketSize({ start, end, numBuckets: 50 }).bucketSize,
    });

    const commonFiltersList: QueryDslQueryContainer[] = [...rangeQuery(start, end)];

    if (filters[HOST_NAME]) {
      commonFiltersList.push({
        bool: {
          should: [
            ...termQuery(HOST_NAME, filters[HOST_NAME]),
            ...termQuery(HOST_HOSTNAME, filters[HOST_HOSTNAME]),
          ],
          minimum_should_match: 1,
        },
      });
    }

    // The services with their latest agent name, most documents first, like a terms aggregation
    // with a top_metrics sub-aggregation.
    const servicesQuery = (index: string[]) =>
      esql.from(index).addSetCommand('unmapped_fields', 'nullify').pipe`WHERE ${esql.col(
        SERVICE_NAME
      )} IS NOT NULL`
        .pipe`STATS doc_count = COUNT(*), latest_timestamp = MAX(@timestamp), agent_name = LAST(${esql.col(
        AGENT_NAME
      )}, @timestamp) BY ${esql.col(SERVICE_NAME)}`.pipe`SORT doc_count DESC, ${esql.col(
        SERVICE_NAME
      )} ASC`.limit(size);

    // get services from transaction metrics
    const metricsResponse = await apmEventClient.esql('get_apm_host_services_from_metrics', {
      apm: {
        sources: [
          {
            documentType: ApmDocumentType.TransactionMetric,
            rollupInterval: RollupInterval.OneMinute,
          },
        ],
      },
      query: servicesQuery,
      filter: {
        bool: {
          filter: [
            {
              bool: {
                should: [
                  ...termQuery(METRICSET_NAME, 'app'),
                  {
                    bool: {
                      must: [...termQuery(METRICSET_NAME, 'transaction')],
                    },
                  },
                ],
                minimum_should_match: 1,
              },
            },
            ...commonFiltersList,
          ],
        },
      },
    });

    // get services from logs
    const logsResponse = await apmEventClient.esql('get_apm_host_services_from_logs', {
      apm: {
        sources: [
          {
            documentType: ApmDocumentType.ErrorEvent,
            rollupInterval: sourcesToUse.source.rollupInterval,
          },
        ],
      },
      query: servicesQuery,
      filter: {
        bool: {
          filter: commonFiltersList,
        },
      },
    });

    const serviceMap = [...toServices(metricsResponse), ...toServices(logsResponse)].reduce(
      (acc, { serviceName, latestTimestamp, agentName }) => {
        // dedup and get the latest timestamp
        const existingService = acc.get(serviceName);
        if (!existingService || existingService.latestTimestamp < latestTimestamp) {
          acc.set(serviceName, { latestTimestamp, agentName });
        }
        return acc;
      },
      new Map<string, { latestTimestamp: string; agentName: string | null }>()
    );
    const services = Array.from(serviceMap)
      .slice(0, size)
      .map(([serviceName, { agentName }]) => ({
        serviceName,
        agentName,
      }));
    return { services };
  };
}
