/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type { MobileErrorType } from '@kbn/apm-types';
import {
  DEVICE_MODEL_IDENTIFIER,
  HOST_OS_VERSION,
  SERVICE_NAME,
  SERVICE_VERSION,
  TRANSACTION_TYPE,
} from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { ApmDocumentType } from '../../../common/document_type';
import { RollupInterval } from '../../../common/rollup';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlTermsBuckets, topTermsQuery, whereTerm } from '../../lib/helpers/esql_values';
import { mobileErrorTypeQuery } from './mobile_error_type_query';

export async function getDeviceOSApp({
  kuery,
  apmEventClient,
  serviceName,
  transactionType,
  errorType,
  environment,
  start,
  end,
  size,
}: {
  kuery: string;
  apmEventClient: APMEventClient;
  serviceName: string;
  transactionType?: string;
  errorType?: MobileErrorType;
  environment: string;
  start: number;
  end: number;
  size: number;
}) {
  const apm = {
    sources: [
      {
        documentType: errorType ? ApmDocumentType.ErrorEvent : ApmDocumentType.TransactionEvent,
        rollupInterval: RollupInterval.None,
      },
    ],
  };
  const filter = {
    bool: {
      filter: [
        // The transactionType filter is only relevant for transaction documents;
        // error documents are scoped by error.type instead.
        ...(errorType ? mobileErrorTypeQuery(errorType) : []),
        ...rangeQuery(start, end),
        ...environmentQuery(environment),
        ...kqlQuery(kuery),
      ],
    },
  };
  // The fields are not mapped in every index, so unmapped fields read as null.
  const topTerms = (operationName: string, field: string) =>
    apmEventClient.esql(operationName, {
      apm,
      query: (index) =>
        topTermsQuery(
          whereTerm(
            whereTerm(
              esql.from(index).addSetCommand('unmapped_fields', 'nullify'),
              SERVICE_NAME,
              serviceName
            ),
            TRANSACTION_TYPE,
            errorType ? undefined : transactionType
          ),
          field
        ),
      filter,
    });

  const [devices, osVersions, appVersions] = await Promise.all([
    topTerms('get_mobile_device_os_app_devices', DEVICE_MODEL_IDENTIFIER),
    topTerms('get_mobile_device_os_app_os_versions', HOST_OS_VERSION),
    topTerms('get_mobile_device_os_app_app_versions', SERVICE_VERSION),
  ]);

  return {
    aggregations: {
      devices: esqlTermsBuckets(devices, DEVICE_MODEL_IDENTIFIER, size),
      osVersions: esqlTermsBuckets(osVersions, HOST_OS_VERSION, size),
      appVersions: esqlTermsBuckets(appVersions, SERVICE_VERSION, size),
    },
  };
}
