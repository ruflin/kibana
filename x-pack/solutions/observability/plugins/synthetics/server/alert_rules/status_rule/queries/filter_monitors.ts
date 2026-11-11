/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KueryNode } from '@kbn/es-query';
import { fromKueryExpression, toElasticsearchQuery } from '@kbn/es-query';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import type { SyntheticsMonitorStatusRuleParams as StatusRuleParams } from '@kbn/response-ops-rule-params/synthetics_monitor_status';
import { ALL_SPACES_ID } from '@kbn/security-plugin/common/constants';
import { esql } from '@elastic/esql';
import type { SyntheticsEsClient } from '../../../lib';
import { esqlRows } from '../../../lib/esql_read';
import {
  FINAL_SUMMARY_FILTER,
  getRangeFilter,
  getTimeSpanFilter,
} from '../../../../common/constants/client_defaults';

export async function queryFilterMonitors({
  spaceId,
  esClient,
  ruleParams,
}: {
  spaceId: string;
  esClient: SyntheticsEsClient;
  ruleParams: StatusRuleParams;
}) {
  if (!ruleParams.kqlQuery) {
    return;
  }

  let kueryNode: KueryNode;

  // This is to check if the kqlQuery is valid, if it is not the fromKueryExpression will throw an error
  try {
    kueryNode = fromKueryExpression(ruleParams.kqlQuery);
  } catch (error) {
    return;
  }

  const filters = toElasticsearchQuery(kueryNode);
  // The rule filters stay in the Query DSL `filter` (KQL output, `terms` on multi-valued fields,
  // date math). ES|QL groups by `config_id`; 10000 matches the cap of the former terms aggregation.
  const response = await esClient.esql(
    esql.from(esClient.heartbeatIndices.split(',')).pipe`STATS BY config_id`.limit(10000),
    {
      operationName: 'queryFilterMonitors',
      filter: {
        bool: {
          filter: [
            FINAL_SUMMARY_FILTER,
            getRangeFilter({ from: 'now-24h/m', to: 'now/m' }),
            getTimeSpanFilter(),
            {
              terms: {
                'meta.space_id': [spaceId, ALL_SPACES_ID],
              },
            },
            {
              bool: {
                should: filters,
              },
            },
            ...getFilters(ruleParams),
          ],
        },
      },
    }
  );

  return esqlRows(response).flatMap((row) =>
    typeof row.config_id === 'string' ? [row.config_id] : []
  );
}

export const getFilters = (ruleParams: StatusRuleParams) => {
  const { monitorTypes, locations, tags, projects } = ruleParams;
  const filters: QueryDslQueryContainer[] = [];
  if (monitorTypes?.length) {
    filters.push({
      terms: {
        'monitor.type': monitorTypes,
      },
    });
  }

  if (locations?.length) {
    filters.push({
      terms: {
        'observer.name': locations,
      },
    });
  }

  if (tags?.length) {
    filters.push({
      terms: {
        tags,
      },
    });
  }

  if (projects?.length) {
    filters.push({
      terms: {
        'monitor.project.id': projects,
      },
    });
  }

  return filters;
};
