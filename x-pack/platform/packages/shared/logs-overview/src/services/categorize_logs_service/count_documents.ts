/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { getSampleProbability } from '@kbn/ml-random-sampler-utils';
import type { ISearchGeneric } from '@kbn/search-types';
import { lastValueFrom } from 'rxjs';
import { fromPromise } from 'xstate';
import type { LogCategorizationParams } from './types';
import { createCategorizationQuery } from './queries';

export const countDocuments = ({ search }: { search: ISearchGeneric }) =>
  fromPromise<
    {
      documentCount: number;
      samplingProbability: number;
    },
    LogCategorizationParams
  >(
    async ({
      input: { index, endTimestamp, startTimestamp, timeField, messageField, documentFilters },
      signal,
    }) => {
      // The exists, range and document filters stay a request `filter`: the document filters come
      // from Discover as Query DSL.
      const { rawResponse } = await lastValueFrom(
        search(
          {
            params: {
              query: esql.from(index.split(',').map((source) => source.trim()))
                .pipe`STATS total = COUNT(*)`.toRequest().query,
              filter: createCategorizationQuery({
                messageField,
                timeField,
                startTimestamp,
                endTimestamp,
                additionalFilters: documentFilters,
              }),
            },
          },
          { abortSignal: signal, strategy: 'esql_async' }
        )
      );

      const { columns, values } = rawResponse as unknown as {
        columns: Array<{ name: string }>;
        values: unknown[][];
      };
      const totalColumn = columns.findIndex(({ name }) => name === 'total');
      const documentCount = Number(values[0]?.[totalColumn] ?? 0);
      const samplingProbability = getSampleProbability(documentCount);

      return {
        documentCount,
        samplingProbability,
      };
    }
  );
