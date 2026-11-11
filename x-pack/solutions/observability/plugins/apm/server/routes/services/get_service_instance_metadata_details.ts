/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { merge } from 'lodash';
import { esql } from '@elastic/esql';
import { rangeQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { accessKnownApmEventFields } from '@kbn/apm-data-access-plugin/server/utils';
import type { ServiceInstanceMetadataDetailsResponse } from '@kbn/apm-api-shared';
import {
  AGENT_NAME,
  AT_TIMESTAMP,
  METRICSET_NAME,
  SERVICE_ENVIRONMENT,
  SERVICE_NAME,
  SERVICE_NODE_NAME,
} from '../../../common/es_fields/apm';
import {
  getBackwardCompatibleDocumentTypeFilter,
  getProcessorEventForTransactions,
} from '../../lib/helpers/transactions';
import { esqlRowAsApmFields } from '../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { asMutableArray } from '../../../common/utils/as_mutable_array';
import {
  SERVICE_METADATA_CLOUD_KEYS,
  SERVICE_METADATA_CONTAINER_KEYS,
  SERVICE_METADATA_INFRA_METRICS_KEYS,
  SERVICE_METADATA_SERVICE_KEYS,
} from '../../../common/service_metadata';

export async function getServiceInstanceMetadataDetails({
  serviceName,
  serviceNodeName,
  apmEventClient,
  start,
  end,
}: {
  serviceName: string;
  serviceNodeName: string;
  apmEventClient: APMEventClient;
  start: number;
  end: number;
}): Promise<ServiceInstanceMetadataDetailsResponse> {
  const filter = { bool: { filter: rangeQuery(start, end) } };

  const requiredKeys = asMutableArray([AT_TIMESTAMP, SERVICE_NAME, AGENT_NAME] as const);

  const optionalKeys = asMutableArray([
    SERVICE_ENVIRONMENT,
    ...SERVICE_METADATA_SERVICE_KEYS,
    ...SERVICE_METADATA_CLOUD_KEYS,
    ...SERVICE_METADATA_CONTAINER_KEYS,
    ...SERVICE_METADATA_INFRA_METRICS_KEYS,
  ] as const);

  const fields = [...requiredKeys, ...optionalKeys];

  const [firstField, ...otherFields] = fields;

  // Cloud, container and host fields are not mapped in every index, so unmapped fields read as null.
  const sampleQuery = (index: string[], metricsetName?: string) => {
    const query = esql.from(index).addSetCommand('unmapped_fields', 'nullify')
      .pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ serviceName }} AND ${esql.col(
      SERVICE_NODE_NAME
    )} == ${{ serviceNodeName }}`;
    return (
      metricsetName ? query.pipe`WHERE ${esql.col(METRICSET_NAME)} == ${{ metricsetName }}` : query
    )
      .keep(firstField, ...otherFields)
      .limit(1);
  };

  async function getApplicationMetricSample() {
    const response = await apmEventClient.esql(
      'get_service_instance_metadata_details_application_metric',
      {
        apm: { events: [ProcessorEvent.metric] },
        query: (index) => sampleQuery(index, 'app'),
        filter,
      }
    );

    const hits = esqlRowAsApmFields(response);

    return hits && accessKnownApmEventFields(hits).requireFields(requiredKeys).unflatten();
  }

  async function getTransactionEventSample() {
    const response = await apmEventClient.esql(
      'get_service_instance_metadata_details_application_transaction_event',
      {
        apm: { events: [ProcessorEvent.transaction] },
        query: (index) => sampleQuery(index),
        filter,
      }
    );

    const hits = esqlRowAsApmFields(response);

    return hits && accessKnownApmEventFields(hits).unflatten();
  }

  async function getTransactionMetricSample() {
    const response = await apmEventClient.esql(
      'get_service_instance_metadata_details_application_transaction_metric',
      {
        apm: { events: [getProcessorEventForTransactions(true)] },
        query: (index) => sampleQuery(index),
        filter: {
          bool: {
            filter: [...rangeQuery(start, end), ...getBackwardCompatibleDocumentTypeFilter(true)],
          },
        },
      }
    );

    const hits = esqlRowAsApmFields(response);

    return hits && accessKnownApmEventFields(hits).unflatten();
  }

  // we can expect the most detail of application metrics,
  // followed by transaction events, and then finally transaction metrics
  const [applicationMetricSample, transactionEventSample, transactionMetricSample] =
    await Promise.all([
      getApplicationMetricSample(),
      getTransactionEventSample(),
      getTransactionMetricSample(),
    ]);

  const sample = merge(
    {},
    transactionMetricSample,
    transactionEventSample,
    applicationMetricSample
  );

  const { agent, service, container, kubernetes, host, cloud } = sample;

  return {
    '@timestamp': sample['@timestamp'],
    agent,
    service,
    container,
    kubernetes,
    host,
    cloud,
  };
}
