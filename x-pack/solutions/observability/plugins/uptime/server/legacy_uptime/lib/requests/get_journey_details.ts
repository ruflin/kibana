/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { UMElasticsearchQueryFn } from '../adapters/framework';
import { esqlRows } from '../esql_read';
import type {
  JourneyStep,
  SyntheticsJourneyApiResponse,
} from '../../../../common/runtime_types/ping/synthetics';

export interface GetJourneyDetails {
  checkGroup: string;
}

export const getJourneyDetails: UMElasticsearchQueryFn<
  GetJourneyDetails,
  SyntheticsJourneyApiResponse['details']
> = async ({ uptimeEsClient, checkGroup }) => {
  const { response: thisJourneyResponse } = await uptimeEsClient.esql(
    (indices) =>
      esql.from(indices, ['_id', '_source']).pipe`WHERE monitor.check_group == ${{ checkGroup }}`
        .pipe`WHERE synthetics.type == "journey/start"`.pipe`KEEP _id, _source`.limit(1),
    { operationName: 'getJourneyDetailsCurrentJourney' }
  );

  const thisJourneyRow = esqlRows(thisJourneyResponse)[0];

  if (thisJourneyRow) {
    const thisJourneySource = Object.assign(
      { _id: thisJourneyRow._id },
      thisJourneyRow._source
    ) as JourneyStep;

    const siblingQuery = (comparison: '<' | '>') => (indices: string[]) => {
      const base = esql.from(indices).pipe`WHERE monitor.id == ${{
        monitorId: thisJourneySource.monitor.id,
      }}`.pipe`WHERE synthetics.type == "journey/start"`;
      const withRange =
        comparison === '<'
          ? base.pipe`WHERE @timestamp < TO_DATETIME(${{ ts: thisJourneySource['@timestamp'] }})`
              .pipe`SORT @timestamp DESC NULLS LAST`
          : base.pipe`WHERE @timestamp > TO_DATETIME(${{ ts: thisJourneySource['@timestamp'] }})`
              .pipe`SORT @timestamp ASC NULLS LAST`;
      return withRange.pipe`KEEP @timestamp, monitor.check_group`.limit(1);
    };

    const { response: previousJourneyResponse } = await uptimeEsClient.esql(siblingQuery('<'), {
      operationName: 'getJourneyDetailsNextJourney',
    });
    const { response: nextJourneyResponse } = await uptimeEsClient.esql(siblingQuery('>'), {
      operationName: 'getJourneyDetailsPreviousJourney',
    });
    const previousJourney = esqlRows(previousJourneyResponse)[0];
    const nextJourney = esqlRows(nextJourneyResponse)[0];
    return {
      timestamp: thisJourneySource['@timestamp'],
      journey: thisJourneySource,
      previous: previousJourney
        ? {
            checkGroup: previousJourney['monitor.check_group'],
            timestamp: previousJourney['@timestamp'],
          }
        : undefined,
      next: nextJourney
        ? {
            checkGroup: nextJourney['monitor.check_group'],
            timestamp: nextJourney['@timestamp'],
          }
        : undefined,
    } as SyntheticsJourneyApiResponse['details'];
  } else {
    return null;
  }
};
