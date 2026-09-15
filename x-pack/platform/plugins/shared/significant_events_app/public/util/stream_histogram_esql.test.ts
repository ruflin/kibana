/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { buildStreamIngestHistogramEsql, getMeaningfulBucketMs } from './stream_histogram_esql';

describe('stream_histogram_esql', () => {
  it('uses the same 24h bucket interval as the Streams list sparkline', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    expect(getMeaningfulBucketMs(dayMs, 25)).toBe(15 * 60 * 1000);
  });

  it('builds the Streams ingest histogram ES|QL query', () => {
    expect(buildStreamIngestHistogramEsql('logs-generic-default', 15 * 60 * 1000)).toContain(
      'STATS doc_count = COUNT(*)'
    );
    expect(buildStreamIngestHistogramEsql('logs-generic-default', 15 * 60 * 1000)).toContain(
      'BUCKET(@timestamp'
    );
  });
});
