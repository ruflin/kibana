/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getStreamNameFromViewName, type Streams } from '@kbn/streams-schema';
import type { StreamsClient } from '@kbn/streams-plugin/server';
import type { DataViewsService } from './data_views_service';
import { toSyntheticQueryStream } from './synthetic_stream';

export const listConfiguredViewNames = async (
  dataViewsService: DataViewsService
): Promise<string[]> => (await dataViewsService.list()).map((view) => view.name);

export const listConfiguredViewDefinitions = async (
  dataViewsService: DataViewsService
): Promise<Streams.all.Definition[]> => (await dataViewsService.list()).map(toSyntheticQueryStream);

/**
 * Allows feature/query routes to accept configured views without requiring a
 * Streams definition or data stream of the same name.
 */
export async function assertAnalysisUnit({
  name,
  streamsClient,
  dataViewsService,
}: {
  name: string;
  streamsClient: StreamsClient;
  dataViewsService: DataViewsService;
}): Promise<void> {
  const configured = await dataViewsService.getByName(name);
  if (configured) {
    return;
  }
  await streamsClient.ensureStream(name);
}

/**
 * Resolves the analysis definition for a view name or legacy stream name.
 * Configured views become synthetic query streams so KI FROM helpers stay view-based.
 */
export async function resolveAnalysisDefinition({
  name,
  streamsClient,
  dataViewsService,
}: {
  name: string;
  streamsClient: StreamsClient;
  dataViewsService: DataViewsService;
}): Promise<Streams.all.Definition> {
  const configured = await dataViewsService.getByName(name);
  if (configured) {
    return toSyntheticQueryStream(configured);
  }

  try {
    return await streamsClient.getStream(name);
  } catch (error) {
    const streamName = getStreamNameFromViewName(name);
    if (streamName) {
      return streamsClient.getStream(streamName);
    }
    throw error;
  }
}
