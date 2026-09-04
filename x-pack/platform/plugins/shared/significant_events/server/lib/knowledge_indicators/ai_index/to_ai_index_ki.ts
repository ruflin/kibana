/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  isStoredFeatureKnowledgeIndicator,
  isStoredQueryKnowledgeIndicator,
  type StoredFeatureKnowledgeIndicator,
  type StoredKnowledgeIndicator,
  type StoredQueryKnowledgeIndicator,
} from '../data_stream';
import {
  buildSearchEmbeddingFeature,
  fromStoredFeature,
} from '../knowledge_indicator_client/serializers';

/** Flattened KI attributes accepted by Context Engine createKi / dest templates. */
export type AiIndexKiAttributes = Record<string, string | number | boolean | string[]>;

export interface AiIndexKiDocument {
  id: string;
  type: 'feature' | 'detection';
  title: string;
  description: string;
  content: string;
  tags?: string[];
  '@timestamp': string;
  attributes: AiIndexKiAttributes;
}

export type AiIndexKiOperation =
  | { action: 'upsert'; id: string; document: AiIndexKiDocument }
  | { action: 'delete'; id: string };

const rescaleUnitInterval = (value: number): number => {
  if (value <= 1 && value >= 0) {
    return value;
  }
  return Math.min(1, Math.max(0, value / 100));
};

const featureDestId = (streamName: string, slug: string): string => `${streamName}/${slug}`;

const queryDestId = (streamName: string, queryId: string): string => `${streamName}/${queryId}`;

const compactAttributes = (attributes: AiIndexKiAttributes): AiIndexKiAttributes => {
  const compact: AiIndexKiAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) {
      continue;
    }
    compact[key] = value;
  }
  return compact;
};

const toFeatureDocument = (doc: StoredFeatureKnowledgeIndicator): AiIndexKiDocument => {
  const streamName = doc['stream.name'];
  const slug = doc.feature.slug;
  const id = featureDestId(streamName, slug);
  const title = doc.title ?? slug;
  const feature = fromStoredFeature(doc);

  return {
    id,
    type: 'feature',
    title,
    description: doc.description,
    content: buildSearchEmbeddingFeature(feature, streamName),
    ...(doc.tags && doc.tags.length > 0 ? { tags: doc.tags } : {}),
    '@timestamp': doc['@timestamp'],
    attributes: compactAttributes({
      stream_name: streamName,
      feature_type: doc.feature.type,
      ...(doc.feature.subtype ? { subtype: doc.feature.subtype } : {}),
      slug,
      confidence: rescaleUnitInterval(doc.feature.confidence),
      ...(doc.evidence && doc.evidence.length > 0 ? { evidence: doc.evidence } : {}),
      ...(doc.feature.evidence_doc_ids && doc.feature.evidence_doc_ids.length > 0
        ? { evidence_doc_ids: doc.feature.evidence_doc_ids }
        : {}),
      ...(doc.excluded === true ? { excluded: true } : {}),
      ...(doc.expires_at ? { expires_at: doc.expires_at } : {}),
      ...(doc.run_id ? { run_id: doc.run_id } : {}),
    }),
  };
};

const toDetectionDocument = (doc: StoredQueryKnowledgeIndicator): AiIndexKiDocument => {
  const streamName = doc['stream.name'];
  const id = queryDestId(streamName, doc.id);
  const featureIds = doc.query.features?.map((feature) => feature.id) ?? [];

  return {
    id,
    type: 'detection',
    title: doc.title,
    description: doc.description,
    content: `${doc.description}\n\nES|QL:\n${doc.query.esql}`,
    '@timestamp': doc['@timestamp'],
    attributes: compactAttributes({
      stream_name: streamName,
      esql: doc.query.esql,
      query_type: doc.query.query_type,
      ...(doc.query.severity_score !== undefined
        ? { severity_score: rescaleUnitInterval(doc.query.severity_score) }
        : {}),
      rule_backed: doc.query.rule_backed,
      rule_id: doc.query.rule_id,
      ...(featureIds.length > 0 ? { feature_ids: featureIds } : {}),
      ...(doc.evidence && doc.evidence.length > 0 ? { evidence: doc.evidence } : {}),
      ...(doc.expires_at ? { expires_at: doc.expires_at } : {}),
    }),
  };
};

export const destIdForStoredDoc = (doc: StoredKnowledgeIndicator): string | undefined => {
  if (isStoredFeatureKnowledgeIndicator(doc)) {
    return featureDestId(doc['stream.name'], doc.feature.slug);
  }
  if (isStoredQueryKnowledgeIndicator(doc)) {
    return queryDestId(doc['stream.name'], doc.id);
  }
  if (doc.type === 'query') {
    return queryDestId(doc['stream.name'], doc.id);
  }
  // Feature tombstones only carry the domain UUID, not the slug, so they cannot
  // be mapped to `<stream>/<slug>`. Callers should pass the pre-delete revision.
  return undefined;
};

/** Maps current revisions onto dest deletes (used when the domain write is a tombstone). */
export const toAiIndexDeleteOperations = (
  docs: StoredKnowledgeIndicator[]
): AiIndexKiOperation[] => {
  const operations: AiIndexKiOperation[] = [];
  for (const doc of docs) {
    const id = destIdForStoredDoc(doc);
    if (id !== undefined) {
      operations.push({ action: 'delete', id });
    }
  }
  return operations;
};

/** Maps stored KI revisions onto AI Index upsert/delete operations. Nested filter/properties/meta are omitted. */
export const toAiIndexKiOperations = (docs: StoredKnowledgeIndicator[]): AiIndexKiOperation[] => {
  const operations: AiIndexKiOperation[] = [];

  for (const doc of docs) {
    if ('deleted' in doc && doc.deleted === true) {
      const id = destIdForStoredDoc(doc);
      if (id !== undefined) {
        operations.push({ action: 'delete', id });
      }
      continue;
    }

    if (isStoredFeatureKnowledgeIndicator(doc)) {
      const document = toFeatureDocument(doc);
      operations.push({ action: 'upsert', id: document.id, document });
      continue;
    }

    if (isStoredQueryKnowledgeIndicator(doc)) {
      const document = toDetectionDocument(doc);
      operations.push({ action: 'upsert', id: document.id, document });
    }
  }

  return operations;
};
