/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ElasticsearchClient } from '../elasticsearch_client';
import { getIndexCount } from '.';

describe('getIndexCount', () => {
  const setup = (values: unknown[][]) => {
    const query = jest
      .fn()
      .mockResolvedValue({ columns: [{ name: 'total', type: 'long' }], values });
    return { query, esClient: { esql: { query } } as unknown as ElasticsearchClient };
  };

  it('counts the documents of the index with a STATS', async () => {
    const { esClient, query } = setup([[42]]);

    await expect(getIndexCount({ esClient, index: '.siem-signals-default-000001' })).resolves.toBe(
      42
    );
    expect(query).toHaveBeenCalledWith({
      query: 'FROM .siem-signals-default-000001 | STATS total = COUNT(*)',
    });
  });

  it('quotes an index name that is not a plain index pattern', async () => {
    const { esClient, query } = setup([[0]]);

    await getIndexCount({ esClient, index: 'a" | DROP x' });

    expect(query).toHaveBeenCalledWith({
      query: 'FROM "a\\" | DROP x" | STATS total = COUNT(*)',
    });
  });
});
