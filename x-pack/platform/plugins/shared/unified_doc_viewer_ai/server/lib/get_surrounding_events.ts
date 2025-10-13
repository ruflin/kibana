/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';

const SURROUNDING_EVENTS_COUNT = 5;

/**
 * Extract resource fields from a document for filtering
 */
function extractResourceFields(document: Record<string, any>): Record<string, any> {
  const resources: Record<string, any> = {};
  
  // Common resource field patterns
  const resourceFieldPatterns = [
    'service.name',
    'service',
    'host.name',
    'hostname',
    'host',
    'container.id',
    'container.name',
    'container',
    'kubernetes.namespace',
    'namespace',
    'kubernetes.cluster.name',
    'cluster',
    'pod.name',
    'pod',
    'agent.name',
    'agent.id',
  ];

  for (const pattern of resourceFieldPatterns) {
    const value = getNestedValue(document, pattern);
    if (value) {
      resources[pattern] = value;
    }
  }

  return resources;
}

/**
 * Get nested value from an object using dot notation
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Extract timestamp from document
 */
function extractTimestamp(document: Record<string, any>): string | number | undefined {
  // Try common timestamp fields
  const timestampFields = ['@timestamp', 'timestamp', 'time', 'event.created'];
  
  for (const field of timestampFields) {
    const value = getNestedValue(document, field);
    if (value) {
      return value;
    }
  }
  
  return undefined;
}

/**
 * Extract index pattern from document metadata
 */
function extractIndexPattern(document: Record<string, any>): string {
  // Check if document has _index field
  if (document._index) {
    // Extract pattern (e.g., "logs-*" from "logs-2024.01.01")
    const index = document._index;
    const parts = index.split('-');
    if (parts.length > 1) {
      return `${parts[0]}-*`;
    }
    return index;
  }
  
  // Default fallback
  return '*';
}

/**
 * Query Elasticsearch for surrounding events
 */
export async function getSurroundingEvents(
  esClient: ElasticsearchClient,
  document: Record<string, any>,
  dataViewId: string | undefined,
  logger: Logger
): Promise<any[]> {
  try {
    // Extract timestamp
    const timestamp = extractTimestamp(document);
    if (!timestamp) {
      logger.warn('No timestamp found in document, cannot query surrounding events');
      return [];
    }

    // Extract resource fields for filtering
    const resourceFields = extractResourceFields(document);
    if (Object.keys(resourceFields).length === 0) {
      logger.warn('No resource fields found in document, cannot filter surrounding events');
      return [];
    }

    logger.debug(`Timestamp: ${timestamp}, Resource fields: ${JSON.stringify(resourceFields)}`);

    // Build filter query for resource fields
    const must: any[] = resourceFields ? Object.entries(resourceFields).map(([field, value]) => ({
      term: { [field]: value },
    })) : [];

    // Determine index pattern
    const indexPattern = extractIndexPattern(document);
    logger.debug(`Using index pattern: ${indexPattern}`);

    // Query for previous events (before timestamp)
    const previousQuery = {
      index: indexPattern,
      size: SURROUNDING_EVENTS_COUNT,
      body: {
        query: {
          bool: {
            must,
            filter: [
              {
                range: {
                  [Object.keys(document).find(k => k === '@timestamp' || k === 'timestamp') || '@timestamp']: {
                    lt: timestamp,
                  },
                },
              },
            ],
          },
        },
        sort: [
          {
            [Object.keys(document).find(k => k === '@timestamp' || k === 'timestamp') || '@timestamp']: {
              order: 'desc',
            },
          },
        ],
      },
    };

    // Query for next events (after timestamp)
    const nextQuery = {
      index: indexPattern,
      size: SURROUNDING_EVENTS_COUNT,
      body: {
        query: {
          bool: {
            must,
            filter: [
              {
                range: {
                  [Object.keys(document).find(k => k === '@timestamp' || k === 'timestamp') || '@timestamp']: {
                    gt: timestamp,
                  },
                },
              },
            ],
          },
        },
        sort: [
          {
            [Object.keys(document).find(k => k === '@timestamp' || k === 'timestamp') || '@timestamp']: {
              order: 'asc',
            },
          },
        ],
      },
    };

    // Execute queries in parallel
    logger.debug('Executing surrounding events queries...');
    const [previousResults, nextResults] = await Promise.all([
      esClient.search(previousQuery).catch((error) => {
        logger.warn(`Failed to query previous events: ${error.message}`);
        return { hits: { hits: [] } };
      }),
      esClient.search(nextQuery).catch((error) => {
        logger.warn(`Failed to query next events: ${error.message}`);
        return { hits: { hits: [] } };
      }),
    ]);

    // Extract and combine results
    const previousHits = (previousResults.hits?.hits || []).map((hit: any) => hit._source);
    const nextHits = (nextResults.hits?.hits || []).map((hit: any) => hit._source);

    // Reverse previous hits so they're in chronological order
    previousHits.reverse();

    const allEvents = [...previousHits, ...nextHits];
    logger.info(`Retrieved ${previousHits.length} previous and ${nextHits.length} next events`);

    return allEvents;
  } catch (error: any) {
    logger.error(`Error querying surrounding events: ${error.message}`);
    throw error;
  }
}

