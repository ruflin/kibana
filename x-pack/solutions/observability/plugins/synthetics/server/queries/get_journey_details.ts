/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { SyntheticsEsClient } from '../lib';
import { esqlRows } from '../lib/esql_read';
import { getCheckGroupTimeRangeFilter } from '../../common/constants/client_defaults';
import { getSyntheticsScopedIndex } from '../../common/get_synthetics_indices';
import type { JourneyStep, Ping, SyntheticsJourneyApiResponse } from '../../common/runtime_types';

export interface GetJourneyDetails {
  checkGroup: string;
  remoteName?: string;
  timestamp?: string;
}

type DocumentSource = (Ping & { '@timestamp': string; synthetics: { type: string } }) | JourneyStep;

export const getJourneyDetails = async ({
  syntheticsEsClient,
  checkGroup,
  remoteName,
  timestamp,
}: GetJourneyDetails & {
  syntheticsEsClient: SyntheticsEsClient;
}): Promise<SyntheticsJourneyApiResponse['details']> => {
  const indices = getSyntheticsScopedIndex(remoteName, syntheticsEsClient.heartbeatIndices).split(
    ','
  );

  // The current-run lookup targets a single `check_group`, so it can be bounded to the run's
  // `@timestamp` to prune frozen-tier shards. The sibling (previous/next) queries below are
  // intentionally left unbounded since an adjacent run can be arbitrarily far away in time.
  const thisJourneyResponse = await syntheticsEsClient.esql(
    esql.from(indices, ['_id', '_source']).pipe`WHERE monitor.check_group == ${{ checkGroup }}`
      .pipe`WHERE synthetics.type IN ("journey/start", "heartbeat/summary")`
      .pipe`KEEP _id, _source`.limit(2),
    {
      operationName: 'getJourneyDetailsCurrentJourney',
      ...(timestamp ? { filter: getCheckGroupTimeRangeFilter(timestamp) } : {}),
    }
  );

  const thisJourney = esqlRows(thisJourneyResponse).flatMap(({ _id, _source }) =>
    typeof _id === 'string' && _source !== null && typeof _source === 'object'
      ? [{ _id, _source: _source as DocumentSource }]
      : []
  );

  const journeyStartHit = thisJourney.find(
    (hit) => hit._source.synthetics?.type === 'journey/start'
  );

  const journeySummaryHit = thisJourney.find(
    ({ _source: summarySource }) => summarySource.synthetics?.type === 'heartbeat/summary'
  );

  const foundJourney = journeyStartHit || journeySummaryHit;

  const journeySource = journeySummaryHit?._source ?? journeyStartHit?._source;

  if (journeySource && foundJourney) {
    const siblingQuery = (comparison: '<' | '>', order: 'ASC' | 'DESC') => {
      const location = journeySource.observer?.geo?.name;
      const base = esql.from(indices).pipe`WHERE monitor.check_group != ${{
        checkGroup: journeySource.monitor.check_group,
      }}`.pipe`WHERE monitor.id == ${{ monitorId: journeySource.monitor.id }}`;
      const withLocation = location
        ? base.pipe`WHERE observer.geo.name == ${{ location }}`
        : base.pipe`WHERE observer.geo.name IS NULL`;
      const withType = withLocation.pipe`WHERE synthetics.type IN ("journey/start", "heartbeat/summary")`;
      const withRange =
        comparison === '<'
          ? withType.pipe`WHERE @timestamp < TO_DATETIME(${{ ts: journeySource['@timestamp'] }})`
          : withType.pipe`WHERE @timestamp > TO_DATETIME(${{ ts: journeySource['@timestamp'] }})`;
      return (order === 'DESC'
        ? withRange.pipe`SORT @timestamp DESC NULLS LAST`
        : withRange.pipe`SORT @timestamp ASC NULLS LAST`
      ).pipe`KEEP @timestamp, monitor.check_group`.limit(1);
    };

    const [previousResponse, nextResponse] = await Promise.all([
      syntheticsEsClient.esql(siblingQuery('<', 'DESC'), {
        operationName: 'getJourneyDetailsPreviousJourney',
      }),
      syntheticsEsClient.esql(siblingQuery('>', 'ASC'), {
        operationName: 'getJourneyDetailsNextJourney',
      }),
    ]);

    const toSibling = (response: typeof previousResponse): DocumentSource | undefined => {
      const row = esqlRows(response)[0];
      return row
        ? ({
            '@timestamp': row['@timestamp'],
            monitor: { check_group: row['monitor.check_group'] },
          } as DocumentSource)
        : undefined;
    };

    const summaryPing = thisJourney.find(
      ({ _source: summarySource }) => summarySource.synthetics?.type === 'heartbeat/summary'
    )?._source;

    return {
      timestamp: journeySource['@timestamp'],
      journey: { ...journeySource, _id: foundJourney._id },
      ...(summaryPing && 'state' in summaryPing && summaryPing.state
        ? {
            summary: {
              state: summaryPing.state,
            },
          }
        : {}),
      previous: filterNextPrevJourney(
        journeySource.monitor.check_group,
        toSibling(previousResponse)
      ),
      next: filterNextPrevJourney(journeySource.monitor.check_group, toSibling(nextResponse)),
    };
  } else {
    return null;
  }
};

const filterNextPrevJourney = (checkGroup: string, pingSource?: DocumentSource) => {
  return pingSource && pingSource.monitor.check_group !== checkGroup
    ? {
        checkGroup: pingSource.monitor.check_group,
        timestamp: pingSource['@timestamp'],
      }
    : undefined;
};
