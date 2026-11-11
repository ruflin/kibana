/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type { ServiceNodeMetadataResponse } from '@kbn/apm-api-shared';
import { HOST_NAME, CONTAINER_ID } from '../../../common/es_fields/apm';
import { NOT_AVAILABLE_LABEL } from '../../../common/i18n';
import { SERVICE_NAME } from '../../../common/es_fields/apm';
import { environmentQuery, serviceNodeNameQuery } from '../../../common/utils/environment_query';
import { esqlRows } from '../../lib/helpers/esql_read';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import type { ApmServiceTransactionDocumentType } from '../../../common/document_type';
import type { RollupInterval } from '../../../common/rollup';

export async function getServiceNodeMetadata({
  kuery,
  serviceName,
  serviceNodeName,
  apmEventClient,
  start,
  end,
  environment,
  documentType,
  rollupInterval,
}: {
  kuery: string;
  serviceName: string;
  serviceNodeName: string;
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  environment: string;
  documentType: ApmServiceTransactionDocumentType;
  rollupInterval: RollupInterval;
}): Promise<ServiceNodeMetadataResponse> {
  const topValue = async (operationName: string, field: string) => {
    const response = await apmEventClient.esql(operationName, {
      apm: { sources: [{ documentType, rollupInterval }] },
      // The field is not mapped in every index, so unmapped fields read as null.
      query: (index) =>
        esql.from(index).addSetCommand('unmapped_fields', 'nullify').pipe`WHERE ${esql.col(
          SERVICE_NAME
        )} == ${{ serviceName }} AND ${esql.col(field)} IS NOT NULL`
          .pipe`STATS doc_count = COUNT(*) BY ${esql.col(field)}`
          .pipe`SORT doc_count DESC, ${esql.col(field)} ASC`.limit(1),
      filter: {
        bool: {
          filter: [
            ...rangeQuery(start, end),
            ...environmentQuery(environment),
            ...kqlQuery(kuery),
            ...serviceNodeNameQuery(serviceNodeName),
          ],
        },
      },
    });
    return esqlRows(response)[0]?.[field] as string | undefined;
  };

  const [host, containerId] = await Promise.all([
    topValue('get_service_node_metadata_host', HOST_NAME),
    topValue('get_service_node_metadata_container_id', CONTAINER_ID),
  ]);

  return {
    host: host || NOT_AVAILABLE_LABEL,
    containerId: containerId || NOT_AVAILABLE_LABEL,
  };
}
