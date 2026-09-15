/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useQuery } from '@kbn/react-query';
import { useKibana } from '../../../../hooks/use_kibana';
import {
  toElasticsearchDataStreams,
  type ElasticsearchDataStream,
} from './build_query_stream_from_data_streams';

export const ELASTICSEARCH_DATA_STREAM_LIST_QUERY_KEY = ['elasticsearchDataStreams'] as const;

const neverRollupIndex = (): boolean => false;

export function useFetchElasticsearchDataStreams() {
  const {
    dependencies: {
      start: {
        data: { dataViews },
      },
    },
  } = useKibana();

  return useQuery<ElasticsearchDataStream[], Error>({
    queryKey: ELASTICSEARCH_DATA_STREAM_LIST_QUERY_KEY,
    queryFn: async (): Promise<ElasticsearchDataStream[]> => {
      const matched = await dataViews.getIndices({
        pattern: '*',
        showAllIndices: false,
        isRollupIndex: neverRollupIndex,
      });
      return toElasticsearchDataStreams(matched);
    },
  });
}
