/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { get } from 'lodash';
import type { ElasticsearchClient } from '@kbn/core/server';
import { esql } from '@elastic/esql';
import { INDEX_PATTERN_ELASTICSEARCH } from '../../../../common/constants';
import { getCcsIndexPattern } from '../../../lib/alerts/get_ccs_index_pattern';
import { runEsqlRows } from '../../../lib/esql_read';

export async function fetchLicenseType(
  client: ElasticsearchClient,
  availableCcs: boolean,
  clusterUuid: string
) {
  let index = INDEX_PATTERN_ELASTICSEARCH;
  if (availableCcs) {
    index = getCcsIndexPattern(index, availableCcs);
  }
  // The latest cluster_stats document of the cluster. `_source` is read as a whole, as the license
  // object is not mapped the same way in every monitoring index.
  const rows = await runEsqlRows(
    client,
    esql.from(index.split(','), ['_source']).pipe`WHERE cluster_uuid == ${{
      clusterUuid,
    }} AND type == "cluster_stats"`.pipe`SORT timestamp DESC NULLS LAST`
      .keep('_source')
      .limit(1)
  );
  return get(rows[0], '_source.license.type') as string | undefined;
}
