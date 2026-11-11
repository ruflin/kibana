/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { SLODefinition } from '../../../../domain/models';
import { SUMMARY_DESTINATION_INDEX_PATTERN } from '../../../../../common/constants';
import type { EsSummaryDocument } from '../../../../services/summary_transform_generator/helpers/create_temp_summary';
import { runEsqlRows } from '../../../../services/utils/esql_read';

export async function getSloSummary(
  esClient: ElasticsearchClient,
  slo: SLODefinition,
  instanceId: string,
  projectRouting?: string
) {
  try {
    const rows = await runEsqlRows({
      esClient,
      projectRouting,
      query: esql.from([SUMMARY_DESTINATION_INDEX_PATTERN], ['_source']).pipe`WHERE slo.id == ${{
        sloId: slo.id,
      }} AND slo.revision == ${{
        sloRevision: slo.revision,
      }} AND slo.instanceId == ${{ instanceId }}`.limit(1),
    });

    return rows.length === 0 ? undefined : (rows[0]._source as EsSummaryDocument | undefined);
  } catch (err) {
    // noop
    return undefined;
  }
}
