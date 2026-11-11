/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getBuckets } from './get_buckets';
import { ApmDocumentType } from '../../../../common/document_type';
import { RollupInterval } from '../../../../common/rollup';
import { esqlResponse, toEsqlRequest } from '../../../utils/esql_test_helpers';

describe('get buckets', () => {
  let clientSpy: jest.Mock;
  let result: Awaited<ReturnType<typeof getBuckets>>;

  beforeEach(async () => {
    clientSpy = jest
      .fn()
      .mockResolvedValueOnce(esqlResponse(['bucket', 'doc_count'], [[1528100000000, 4]]));

    result = await getBuckets({
      environment: 'prod',
      serviceName: 'myServiceName',
      bucketSize: 100000000,
      kuery: '',
      apmEventClient: {
        esql: clientSpy,
      } as any,
      start: 1528113600000,
      end: 1528977600000,
    });
  });

  it('should make the correct query', () => {
    const [operationName, params] = clientSpy.mock.calls[0];
    expect({ operationName, ...toEsqlRequest(params) }).toMatchSnapshot();
  });

  it('should limit query results to error documents', () => {
    const query = clientSpy.mock.calls[0][1];
    expect(query.apm.sources).toEqual([
      {
        documentType: ApmDocumentType.ErrorEvent,
        rollupInterval: RollupInterval.None,
      },
    ]);
  });

  it('should fill the buckets without documents across the whole range', () => {
    expect(result.buckets).toHaveLength(9);
    expect(result.buckets[0]).toEqual({ x: 1528100000000, y: 4 });
    expect(result.buckets[1]).toEqual({ x: 1528200000000, y: 0 });
    expect(result.buckets[8]).toEqual({ x: 1528900000000, y: 0 });
  });
});
