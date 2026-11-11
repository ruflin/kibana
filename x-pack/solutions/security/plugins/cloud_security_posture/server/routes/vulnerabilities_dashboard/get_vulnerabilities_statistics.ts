/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import {
  CDR_LATEST_NATIVE_VULNERABILITIES_INDEX_PATTERN,
  VULNERABILITIES_SEVERITY,
} from '@kbn/cloud-security-posture-common';
import { esqlRows, runEsql } from '../../lib/esql_read';

const toCount = (value: unknown): number => (typeof value === 'number' ? value : 0);

export const getVulnerabilitiesStatisticsQuery = () =>
  esql.from([CDR_LATEST_NATIVE_VULNERABILITIES_INDEX_PATTERN]).pipe`STATS
      critical = COUNT(*) WHERE vulnerability.severity == ${{
        critical: VULNERABILITIES_SEVERITY.CRITICAL,
      }},
      high = COUNT(*) WHERE vulnerability.severity == ${{ high: VULNERABILITIES_SEVERITY.HIGH }},
      medium = COUNT(*) WHERE vulnerability.severity == ${{
        medium: VULNERABILITIES_SEVERITY.MEDIUM,
      }},
      resources_scanned = COUNT_DISTINCT(resource.id),
      cloud_accounts = COUNT_DISTINCT(cloud.account.id)`;

export const getVulnerabilitiesStatistics = async (esClient: ElasticsearchClient) => {
  const queryResult = await runEsql({ esClient, query: getVulnerabilitiesStatisticsQuery() });
  const row = esqlRows(queryResult)[0];

  return {
    criticalCount: toCount(row?.critical),
    highCount: toCount(row?.high),
    mediumCount: toCount(row?.medium),
    resourcesScanned: toCount(row?.resources_scanned),
    cloudAccounts: toCount(row?.cloud_accounts),
  };
};
