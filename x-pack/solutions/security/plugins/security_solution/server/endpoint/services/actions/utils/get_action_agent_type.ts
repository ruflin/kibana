/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { esql } from '@elastic/esql';
import { esqlRows, runEsqlRead } from '../../../../lib/entity_analytics/utils/esql_read';
import { ENDPOINT_ACTIONS_INDEX } from '../../../../../common/endpoint/constants';
import { catchAndWrapError } from '../../../utils';
import { NotFoundError } from '../../../errors';
import type { ResponseActionAgentType } from '../../../../../common/endpoint/service/response_actions/constants';

/**
 * Returns the `agentType` for a given response action
 */
export const getActionAgentType = async (
  esClient: ElasticsearchClient,
  actionId: string
): Promise<{ agentType: ResponseActionAgentType }> => {
  const response = await runEsqlRead({
    esClient,
    query: esql.from([ENDPOINT_ACTIONS_INDEX]).where`action_id == ${{ actionId }}`
      .pipe`KEEP EndpointActions.input_type`.limit(1),
    // The index pattern may match nothing, which the search read as an empty result.
    tolerateMissingIndex: true,
  }).catch(catchAndWrapError);

  const agentType = esqlRows(response)[0]?.['EndpointActions.input_type'];

  if (typeof agentType !== 'string' || !agentType) {
    throw new NotFoundError(`Action id [${actionId}] not found`, response);
  }

  return { agentType: agentType as ResponseActionAgentType };
};
