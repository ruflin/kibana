/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { SearchHit } from '@elastic/elasticsearch/lib/api/types';
import type { APMEventClient } from '@kbn/apm-data-access-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { rangeQuery } from '@kbn/observability-plugin/server';
import {
  PARENT_ID,
  PROCESSOR_EVENT,
  SERVICE_NAME,
  SPAN_ID,
  TRACE_ID,
  TRANSACTION_ID,
} from '../../../common/es_fields/apm';
import { esqlRows } from '../../lib/helpers/esql_read';
import { whereTerm } from '../../lib/helpers/esql_values';
import { ecsOnlyOptionalFields, fields, optionalFields } from './trace_constants';

const MAX_ANCESTOR_HOPS = 50;

export type FocusedTraceHit = Pick<SearchHit, 'fields'>;

export function getTraceHitId(hit: FocusedTraceHit): string | undefined {
  return firstStringField(hit.fields, SPAN_ID) ?? firstStringField(hit.fields, TRANSACTION_ID);
}

export function getTraceHitParentId(hit: FocusedTraceHit): string | undefined {
  return firstStringField(hit.fields, PARENT_ID);
}

function firstStringField(hitFields: SearchHit['fields'], fieldName: string): string | undefined {
  if (!hitFields) {
    return undefined;
  }

  const value = Reflect.get(hitFields, fieldName);
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0];
  }

  return undefined;
}

/**
 * Ranked waterfall pagination can drop the focused transaction when a large
 * multi-root trace spends `maxTraceItems` on long sibling roots. Fetch the
 * focused document and its ancestors, then merge them into the ranked hits
 * while staying at `maxTraceItems`.
 */
export async function ensureFocusedTraceHits<THit extends FocusedTraceHit>({
  apmEventClient,
  hits,
  focusedDocId,
  maxTraceItems,
  traceId,
  start,
  end,
  ecsOnly,
  serviceName,
}: {
  apmEventClient: APMEventClient;
  hits: THit[];
  focusedDocId: string;
  maxTraceItems: number;
  traceId: string;
  start: number;
  end: number;
  ecsOnly: boolean;
  serviceName?: string;
}): Promise<THit[]> {
  const hitsById = new Map<string, THit>();
  for (const hit of hits) {
    const id = getTraceHitId(hit);
    if (id) {
      hitsById.set(id, hit);
    }
  }

  const reserved: THit[] = [];
  const walkedIds = new Set<string>();
  let idsToFetch = hitsById.has(focusedDocId) ? [] : [focusedDocId];
  let currentId = focusedDocId;

  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
    if (walkedIds.has(currentId)) {
      break;
    }
    walkedIds.add(currentId);
    if (idsToFetch.length > 0) {
      const fetchedHits = await fetchTraceHitsByIds({
        apmEventClient,
        traceId,
        start,
        end,
        ids: idsToFetch,
        ecsOnly,
        serviceName,
      });

      for (const fetchedHit of fetchedHits) {
        const id = getTraceHitId(fetchedHit);
        if (!id || !idsToFetch.includes(id) || hitsById.has(id)) {
          continue;
        }
        // Intentional `as THit` type assertion as apmEventClient.esql rows are shaped like generic Elasticsearch SearchHit documents;
        const typedHit = fetchedHit as THit;
        hitsById.set(id, typedHit);
        reserved.push(typedHit);
      }
    }

    const currentHit = hitsById.get(currentId);
    const parentId = currentHit ? getTraceHitParentId(currentHit) : undefined;
    if (!parentId) {
      break;
    }

    // A parent already on the ranked page still needs its own parent fetched.
    currentId = parentId;
    idsToFetch = hitsById.has(parentId) ? [] : [parentId];
  }

  if (reserved.length === 0) {
    return hits;
  }

  // Pin the focused document and every ancestor already resolved, including
  // hits that were on the ranked page. Newly fetched ancestors take slots from
  // the tail, and the selected document is often that tail.
  const chain: THit[] = [];
  const seenChainIds = new Set<string>();
  let chainId: string | undefined = focusedDocId;

  for (let hop = 0; hop < MAX_ANCESTOR_HOPS && chainId && !seenChainIds.has(chainId); hop++) {
    seenChainIds.add(chainId);
    const chainHit = hitsById.get(chainId);
    if (!chainHit) {
      break;
    }
    chain.push(chainHit);
    chainId = getTraceHitParentId(chainHit);
  }

  const rankedRemainder = hits.filter((hit) => {
    const id = getTraceHitId(hit);
    return id !== undefined && !seenChainIds.has(id);
  });
  const keptChain = chain.slice(0, maxTraceItems);
  const remainingSlots = Math.max(0, maxTraceItems - keptChain.length);

  return [...keptChain, ...rankedRemainder.slice(0, remainingSlots)];
}

async function fetchTraceHitsByIds({
  apmEventClient,
  traceId,
  start,
  end,
  ids,
  ecsOnly,
  serviceName,
}: {
  apmEventClient: APMEventClient;
  traceId: string;
  start: number;
  end: number;
  ids: string[];
  ecsOnly: boolean;
  serviceName?: string;
}): Promise<FocusedTraceHit[]> {
  if (ids.length === 0) {
    return [];
  }

  const columns = [...fields, ...(ecsOnly ? ecsOnlyOptionalFields : optionalFields)];
  const [firstColumn, ...otherColumns] = columns;

  const response = await apmEventClient.esql('get_focused_trace_items', {
    apm: {
      events: [ProcessorEvent.span, ProcessorEvent.transaction],
    },
    // `_source` carries the transaction marks, which are not a mapped column. The optional
    // fields are not mapped in every index, so unmapped fields read as null.
    query: (index) =>
      // Child spans copy transaction.id from their transaction. Restrict that
      // clause to transaction documents so a span cannot take the only hit.
      whereTerm(
        // The service flyout passes serviceName, and its ranked page is already
        // limited to that service. Ancestors from other services stay out so they
        // cannot take maxTraceItems slots. Callers that omit serviceName, such as
        // transaction details, still reserve the full cross-service chain.
        whereTerm(
          esql.from(index, ['_source']).addSetCommand('unmapped_fields', 'nullify'),
          TRACE_ID,
          traceId
        ),
        SERVICE_NAME,
        serviceName
      ).pipe`WHERE (${esql.col(TRANSACTION_ID)} IN (${{ transactionIds: ids }}) AND ${esql.col(
        PROCESSOR_EVENT
      )} == ${{ processorEvent: ProcessorEvent.transaction }}) OR ${esql.col(SPAN_ID)} IN (${{
        spanIds: ids,
      }})`
        .keep(firstColumn, ...otherColumns, '_source')
        .limit(ids.length),
    filter: { bool: { filter: rangeQuery(start, end) } },
    skipProcessorEventFilter: !ecsOnly,
  });

  return esqlRows(response).map((row) => {
    const { _source: source, ...columnValues } = row;
    return {
      fields: Object.fromEntries(
        Object.entries(columnValues)
          .filter(([, value]) => value !== null && value !== undefined)
          .map(([name, value]) => [name, Array.isArray(value) ? value : [value]])
      ),
      _source: source,
    };
  });
}
