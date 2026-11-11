/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useEffect, useState } from 'react';
import { esql } from '@elastic/esql';
import { getESQLResults } from '@kbn/esql-utils';
import { esqlResponseToRecords } from '../../../../common/utils/esql';
import { useKibana } from '../../../../common/lib/kibana';
import { useTIDataView } from './use_ti_data_view';

// Indicators carry `event.category` and `event.type` as arrays, and an ES|QL `WHERE` equality
// does not match a multi-valued field, so the two terms stay a Query DSL `filter`.
const INDICATOR_FILTER = {
  bool: {
    must: [
      { term: { 'event.category': { value: 'threat' } } },
      { term: { 'event.type': { value: 'indicator' } } },
    ],
  },
};

export const useIndicatorsTotalCount = () => {
  const {
    services: {
      data: { search: searchService },
    },
  } = useKibana();
  const [count, setCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const { selectedPatterns, loading: loadingDataView } = useTIDataView();

  useEffect(() => {
    if (selectedPatterns.length === 0) return;
    // The total is exact here, where the search it replaces stopped counting at 10,000.
    const esqlQuery = esql.from(selectedPatterns).pipe`STATS total = COUNT(*)`.print('basic');

    getESQLResults({
      esqlQuery,
      search: searchService.search,
      filter: INDICATOR_FILTER,
    })
      .then(({ response }) => {
        const [row] = esqlResponseToRecords<{ total: number }>(response);
        setCount(row?.total ?? 0);
        setIsLoading(false);
      })
      .catch(() => {
        // The count stays at its last value and the hook keeps loading, as it did when the
        // search observable errored.
      });
  }, [searchService, selectedPatterns]);

  return { count, isLoading: isLoading || loadingDataView };
};
