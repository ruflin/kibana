/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { getESQLResults } from '@kbn/esql-utils';
import { useIndicatorsTotalCount } from './use_total_count';
import { TestProvidersComponent, mockedSearchService } from '../../../mocks/test_providers';
import { useKibana } from '../../../../common/lib/kibana';

jest.mock('../../../../common/lib/kibana');
jest.mock('@kbn/esql-utils', () => ({ getESQLResults: jest.fn() }));

const indicatorsResponse = {
  response: { columns: [{ name: 'total', type: 'long' }], values: [[7]] },
};

describe('useIndicatorsTotalCount()', () => {
  beforeEach(() => {
    jest.mocked(useKibana).mockReturnValue({
      services: { data: { search: mockedSearchService } },
    } as unknown as ReturnType<typeof useKibana>);

    jest.clearAllMocks();
    jest.mocked(getESQLResults).mockResolvedValue(indicatorsResponse as never);
  });

  describe('when mounted', () => {
    beforeEach(async () => {
      await act(async () => {
        renderHook(() => useIndicatorsTotalCount(), {
          wrapper: TestProvidersComponent,
        });
      });
    });

    it('should query the database for threat indicators', async () => {
      expect(getESQLResults).toHaveBeenCalledTimes(1);
    });

    it('counts with ES|QL and keeps the multi-valued event terms in the DSL filter', async () => {
      expect(getESQLResults).toHaveBeenCalledWith(
        expect.objectContaining({
          esqlQuery: expect.stringMatching(/^FROM .+ \| STATS total = COUNT\(\*\)$/),
          filter: {
            bool: {
              must: [
                { term: { 'event.category': { value: 'threat' } } },
                { term: { 'event.type': { value: 'indicator' } } },
              ],
            },
          },
        })
      );
    });
  });

  describe('when rerendered', () => {
    it('should not call the database when rerendered', async () => {
      const { rerender } = renderHook(() => useIndicatorsTotalCount(), {
        wrapper: TestProvidersComponent,
      });

      rerender();

      expect(getESQLResults).toHaveBeenCalledTimes(1);
    });
  });

  describe('when query succeeds', () => {
    it('should return the total count', async () => {
      const { result } = renderHook(() => useIndicatorsTotalCount(), {
        wrapper: TestProvidersComponent,
      });

      await waitFor(() => expect(result.current.count).toEqual(7));
      expect(result.current.isLoading).toEqual(false);
    });
  });
});
