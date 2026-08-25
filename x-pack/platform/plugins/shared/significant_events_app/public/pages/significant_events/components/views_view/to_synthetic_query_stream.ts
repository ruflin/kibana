/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SignificantEventsDataView } from '@kbn/significant-events-schema';
import type { Streams } from '@kbn/streams-schema';

export const toSyntheticQueryStream = (
  view: Pick<SignificantEventsDataView, 'name' | 'query'>
): Streams.QueryStream.Definition => ({
  type: 'query',
  name: view.name,
  description: '',
  updated_at: new Date().toISOString(),
  query: {
    view: view.name,
    esql: view.query ?? `FROM ${view.name}`,
  },
});
