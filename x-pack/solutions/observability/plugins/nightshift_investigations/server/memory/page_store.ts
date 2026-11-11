/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { badRequest } from '@hapi/boom';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { isNotFoundError, isResponseError } from '@kbn/es-errors';
import { isElasticsearchWriteConflict } from '@kbn/occ';
import { isEsqlUnknownIndexError } from '@kbn/storage-adapter';
import {
  MEMORY_INDEX,
  type MemoryArchiveReason,
  type MemoryFilter,
  type MemoryPageSummary,
  type MemoryStats,
  type StoredMemoryPage,
  type MemoryPage,
} from '../../common/memory';
import { formatPageRefs, previewText } from './log_format';
import {
  buildContentSearchQuery,
  buildCountQuery,
  buildDescriptionSearchQuery,
  buildHybridQuery,
  buildListQuery,
  buildPageQuery,
  buildRecentQuery,
  countOf,
  idsOf,
  rowsOf,
  runMemoryEsql,
  type MemoryKeysetCursor,
} from './memory_esql';
import { applyUpdate, displayTelemetry, type CounterState, type CounterUpdate } from './ranking';
import { canonicalizeTag, MAX_MEMORY_TAGS_PER_PAGE } from '../../common/memory_tags';

const MAX_LIST_SIZE = 500;
const DEFAULT_PAGE_SIZE = 25;
/** Exported so the list route's zod bound and the store's clamp share one value. */
export const MAX_PAGE_SIZE = 200;
const MAX_ARCHIVE_ATTEMPTS = 3;
const MAX_COUNTER_UPDATE_ATTEMPTS = 3;
const MEMORY_TAG = 'memory';
const SPACE_ID_FIELD = 'attributes.space_id';
const ARCHIVE_REASON_FIELD = 'attributes.archive_reason';

/** Archived = presence of `archive_reason` (even empty), matching `toPage`. */
const ARCHIVED_CLAUSE: object = { exists: { field: ARCHIVE_REASON_FIELD } };

export type { CounterUpdate };

/** Lost an optimistic-concurrency race; routes answer 409 instead of retrying blindly. */
export class MemoryVersionConflictError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MemoryVersionConflictError';
  }
}

export const MAX_TAG_FILTER_KEYWORDS = MAX_MEMORY_TAGS_PER_PAGE;

export type MemoryRetrieveMatch = 'context' | 'content';

/** Elasticsearch's optimistic-concurrency pair, as the store hands it out. */
export interface MemoryPageVersion {
  seqNo: number;
  primaryTerm: number;
}

export interface VersionedMemoryPage extends MemoryPageVersion {
  page: MemoryPage;
}

export interface MemoryPageWrite {
  slug: string;
  title: string;
  content: string;
  context?: string;
  tags: string[];
  categories: string[];
  references: string[];
  source?: string;
  merged_from?: string[];
  archive_reason?: MemoryArchiveReason;
  /** Provenance. Metadata only — Space remains the tenancy boundary. */
  agent_id?: string;
  conversation_id?: string;
  round_id?: string;
  workflow_execution_id?: string;
  version?: number;
  telemetry?: {
    impressions: number;
    conversions: number;
    last_impression_time: string;
  };
  user: string;
}

export interface MemoryPageListResult {
  pages: MemoryPageSummary[];
  stats: MemoryStats;
  total: number;
  cursor?: string;
}

export interface MemoryPageStore {
  list: (options?: { filter?: MemoryFilter; tags?: readonly string[] }) => Promise<{
    pages: MemoryPageSummary[];
    stats: MemoryStats;
  }>;
  listPaginated: (options?: {
    filter?: MemoryFilter;
    cursor?: string;
    size?: number;
    tags?: readonly string[];
    search?: string;
  }) => Promise<MemoryPageListResult>;
  retrieve: (options?: {
    query?: string;
    size?: number;
    /** Default matches stored `description`; duplicate-detection matches `content`. */
    match?: MemoryRetrieveMatch;
  }) => Promise<MemoryPage[]>;
  get: (id: string) => Promise<MemoryPage | undefined>;
  getMany: (ids: readonly string[]) => Promise<MemoryPage[]>;
  getVersioned: (id: string) => Promise<VersionedMemoryPage | undefined>;
  getByName: (name: string) => Promise<MemoryPage | undefined>;
  upsert: (page: MemoryPageWrite) => Promise<MemoryPage>;
  create: (page: MemoryPageWrite) => Promise<MemoryPage>;
  update: (id: string, page: MemoryPageWrite, version: VersionedMemoryPage) => Promise<MemoryPage>;
  applyCounterUpdates: (updates: readonly CounterUpdate[]) => Promise<void>;
  archive: (
    id: string,
    reason: MemoryArchiveReason,
    user?: string,
    provenance?: { conversationId?: string; roundId?: string; workflowExecutionId?: string }
  ) => Promise<MemoryPage | undefined>;
  archiveVersioned: (
    version: VersionedMemoryPage,
    reason: MemoryArchiveReason,
    user?: string,
    provenance?: { conversationId?: string; roundId?: string; workflowExecutionId?: string }
  ) => Promise<MemoryPage>;
  /** Clears `archive_reason`, returning the memory to active recall. */
  unarchive: (id: string, user?: string) => Promise<MemoryPage | undefined>;
  /** Hard delete, guarded on the revision the caller read. */
  delete: (id: string, version: MemoryPageVersion, user?: string) => Promise<void>;
}

const normalizeSlugText = (slug: string): string =>
  slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const canonicalizeSlug = (slug: string): string =>
  normalizeSlugText(slug)
    .replace(/^(?:memory-|-)+/, '')
    .slice(0, 80)
    .replace(/-+$/, '');

export const toMemoryKiId = (slug: string): string => {
  const normalizedSlug = canonicalizeSlug(slug);
  return `memory_${normalizedSlug}`.slice(0, 512);
};

export const isCanonicalMemoryId = (id: string): boolean => {
  if (!id.startsWith('memory_')) {
    return false;
  }
  const slug = id.slice('memory_'.length);
  return slug.length > 0 && id === toMemoryKiId(slug);
};

export const slugFromMemoryId = (id: string): string => {
  const prefix = `memory_`;
  if (id.startsWith(prefix)) {
    return id.slice(prefix.length);
  }
  return id;
};

export const isoToEpochSeconds = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms / 1000 : 0;
};

export const epochSecondsToIso = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toISOString();

const toCounterState = (telemetry: MemoryPage['telemetry']): CounterState => ({
  impressions: telemetry.impressions,
  conversions: telemetry.conversions,
  lastTime: isoToEpochSeconds(telemetry.last_impression_time),
});

export const toMemoryDisplayTelemetry = (
  page: MemoryPage,
  nowSec: number
): {
  impressions: number;
  conversions: number;
  conversionRate: number;
  confidence: number;
  last_impression_time: string;
} => {
  const shown = displayTelemetry(toCounterState(page.telemetry), nowSec);
  return {
    impressions: shown.impressions,
    conversions: shown.conversions,
    conversionRate: shown.conversionRate,
    confidence: shown.confidence,
    last_impression_time: page.telemetry.last_impression_time,
  };
};

const memoryTags = (tags: string[]): string[] => [
  MEMORY_TAG,
  ...tags.filter((tag) => tag !== MEMORY_TAG),
];

const toPage = (id: string, source: StoredMemoryPage): MemoryPage | undefined => {
  if (source.title === undefined || source.title.length === 0) {
    return undefined;
  }

  const slug = source.attributes?.slug ?? slugFromMemoryId(id);
  const archiveReason = source.attributes?.archive_reason;
  const archived = archiveReason !== undefined;

  return {
    id,
    slug,
    title: source.title,
    content: source.content ?? '',
    context: source.description,
    tags: source.tags ?? [],
    archived,
    source: source.attributes?.source,
    merged_from: source.attributes?.merged_from,
    archive_reason: archiveReason,
    conversation_id: source.attributes?.conversation_id,
    round_id: source.attributes?.round_id,
    workflow_execution_id: source.attributes?.workflow_execution_id,
    version: source.attributes?.version,
    agent_id: source.attributes?.agent_id,
    categories: source.attributes?.categories ?? [],
    references: source.attributes?.references ?? [],
    created_at: source.attributes?.created_at ?? source['@timestamp'] ?? new Date().toISOString(),
    updated_at: source.attributes?.updated_at ?? source['@timestamp'] ?? new Date().toISOString(),
    created_by: source.attributes?.created_by ?? '',
    updated_by: source.attributes?.updated_by ?? '',
    telemetry: {
      impressions: Number(source.attributes?.impressions ?? 0.0),
      conversions: Number(source.attributes?.conversions ?? 0.0),
      last_impression_time:
        source.attributes?.last_impression_time ?? source['@timestamp'] ?? new Date().toISOString(),
    },
  };
};

export const createMemoryPageStore = ({
  esClient,
  logger,
  spaceId,
  signal,
  now = () => Date.now() / 1000,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
  spaceId: string;
  signal?: AbortSignal;
  now?: () => number;
}): MemoryPageStore => {
  const isIndexNotFoundError = (error: unknown): boolean => {
    if (!isResponseError(error) || typeof error.body.error !== 'object') {
      return false;
    }
    return error.body.error.type === 'index_not_found_exception';
  };

  // ES|QL reports a missing index as a 400 `verification_exception`, not the 404 `search` returns.
  const isMissingIndexError = (error: unknown): boolean =>
    isIndexNotFoundError(error) || isEsqlUnknownIndexError(error);

  const idPrefix = `${spaceId}:`;
  const toStoredId = (pageId: string): string => `${idPrefix}${pageId}`;
  /** Drops ids from other spaces and non-canonical page ids. */
  const toPageId = (storedId: string): string | undefined =>
    storedId.startsWith(idPrefix) && isCanonicalMemoryId(storedId.slice(idPrefix.length))
      ? storedId.slice(idPrefix.length)
      : undefined;

  const buildDocument = (
    page: MemoryPageWrite,
    existing: MemoryPage | undefined
  ): StoredMemoryPage => {
    const nowIso = epochSecondsToIso(now());
    return {
      '@timestamp': nowIso,
      type: 'memory',
      title: page.title,
      // The managed AI-index mapping has no `context` field; task recall reads `description`.
      description: page.context ?? existing?.context,
      content: page.content,
      tags: memoryTags(page.tags),
      attributes: {
        slug: page.slug,
        space_id: spaceId,
        ...(page.agent_id !== undefined ? { agent_id: page.agent_id } : {}),
        ...(page.conversation_id !== undefined ? { conversation_id: page.conversation_id } : {}),
        ...(page.round_id !== undefined ? { round_id: page.round_id } : {}),
        ...(page.workflow_execution_id !== undefined
          ? { workflow_execution_id: page.workflow_execution_id }
          : {}),
        version: page.version ?? (existing?.version !== undefined ? existing.version + 1 : 1),
        categories: page.categories,
        ...(page.source !== undefined ? { source: page.source } : {}),
        ...(page.merged_from !== undefined ? { merged_from: page.merged_from } : {}),
        ...(page.archive_reason !== undefined ? { archive_reason: page.archive_reason } : {}),
        references: page.references,
        created_at: existing?.created_at ?? nowIso,
        updated_at: nowIso,
        created_by: existing?.created_by ?? page.user,
        updated_by: page.user,
        impressions: page.telemetry?.impressions ?? existing?.telemetry.impressions ?? 0.0,
        conversions: page.telemetry?.conversions ?? existing?.telemetry.conversions ?? 0.0,
        last_impression_time:
          page.telemetry?.last_impression_time ??
          existing?.telemetry.last_impression_time ??
          nowIso,
      },
    };
  };

  const mapWrittenPage = (id: string, document: StoredMemoryPage): MemoryPage => {
    const updated = toPage(id, document);
    if (!updated) {
      throw new Error(`Failed to map standard index response to MemoryPage for ${id}`);
    }
    return updated;
  };

  const writeVersionedPage = async (
    id: string,
    page: MemoryPageWrite,
    version: VersionedMemoryPage
  ): Promise<MemoryPage> => {
    const document = buildDocument(page, version.page);
    await esClient.index(
      {
        index: MEMORY_INDEX,
        id: toStoredId(id),
        document,
        if_seq_no: version.seqNo,
        if_primary_term: version.primaryTerm,
        refresh: 'wait_for',
      },
      { signal }
    );
    return mapWrittenPage(id, document);
  };

  /** Shared by archive and restore so neither can drop a provenance field. */
  const toWrite = (page: MemoryPage): MemoryPageWrite => ({
    slug: page.slug,
    title: page.title,
    content: page.content,
    context: page.context,
    tags: page.tags,
    categories: page.categories,
    references: page.references,
    agent_id: page.agent_id,
    conversation_id: page.conversation_id,
    round_id: page.round_id,
    workflow_execution_id: page.workflow_execution_id,
    source: page.source,
    merged_from: page.merged_from,
    telemetry: page.telemetry,
    user: page.updated_by,
  });

  const toArchiveWrite = (
    version: VersionedMemoryPage,
    reason: MemoryArchiveReason,
    user?: string,
    provenance?: { conversationId?: string; roundId?: string; workflowExecutionId?: string }
  ): MemoryPageWrite => {
    const hasExistingProvenance =
      version.page.conversation_id !== undefined ||
      version.page.round_id !== undefined ||
      version.page.workflow_execution_id !== undefined;
    return {
      ...toWrite(version.page),
      ...(!hasExistingProvenance && provenance?.conversationId !== undefined
        ? { conversation_id: provenance.conversationId }
        : {}),
      ...(!hasExistingProvenance && provenance?.roundId !== undefined
        ? { round_id: provenance.roundId }
        : {}),
      ...(!hasExistingProvenance && provenance?.workflowExecutionId !== undefined
        ? { workflow_execution_id: provenance.workflowExecutionId }
        : {}),
      archive_reason: reason,
      user: user ?? version.page.updated_by,
    };
  };

  const spaceAndTagFilter = [
    { term: { tags: MEMORY_TAG } },
    { term: { [SPACE_ID_FIELD]: spaceId } },
  ];

  const tagFilterClauses = (tags: readonly string[] | undefined): object[] => {
    const keywords: string[] = [];
    for (const tag of tags ?? []) {
      const keyword = canonicalizeTag(tag);
      if (keyword === null || keywords.includes(keyword)) continue;
      keywords.push(keyword);
    }
    if (keywords.length > MAX_TAG_FILTER_KEYWORDS) {
      throw badRequest(
        `A Semantic Memory tag filter may name at most ${MAX_TAG_FILTER_KEYWORDS} keywords`
      );
    }
    return keywords.map((keyword) => ({ term: { tags: keyword } }));
  };

  // The listing's scope. It is the request `filter` of every ES|QL read, so Elasticsearch applies it
  // as a Lucene pre-filter; ES|QL cannot filter on the flattened `attributes` subfields itself.
  const scopeFilter = (filter: MemoryFilter, tags?: readonly string[]): QueryDslQueryContainer => {
    const tagClauses = tagFilterClauses(tags);
    switch (filter) {
      case 'active':
        return {
          bool: {
            filter: [
              ...spaceAndTagFilter,
              { bool: { must_not: [ARCHIVED_CLAUSE] } },
              ...tagClauses,
            ] as QueryDslQueryContainer[],
          },
        };
      case 'archived':
        return {
          bool: {
            filter: [
              ...spaceAndTagFilter,
              ARCHIVED_CLAUSE,
              ...tagClauses,
            ] as QueryDslQueryContainer[],
          },
        };
      case 'all':
      default:
        return {
          bool: { filter: [...spaceAndTagFilter, ...tagClauses] as QueryDslQueryContainer[] },
        };
    }
  };

  const activeScope: QueryDslQueryContainer = {
    bool: {
      filter: spaceAndTagFilter as QueryDslQueryContainer[],
      must_not: [ARCHIVED_CLAUSE as QueryDslQueryContainer],
    },
  };

  // Every archived page of the space whatever the listing, for the header count.
  const archivedScope: QueryDslQueryContainer = {
    bool: {
      filter: [...spaceAndTagFilter, ARCHIVED_CLAUSE] as QueryDslQueryContainer[],
    },
  };

  const runEsql = (
    query: Parameters<typeof runMemoryEsql>[0]['query'],
    filter: QueryDslQueryContainer
  ) => runMemoryEsql({ esClient, query, filter, signal });

  const rowsToPages = (rows: Array<{ id: string; source: StoredMemoryPage }>): MemoryPage[] =>
    rows.flatMap(({ id, source }) => {
      const pageId = toPageId(id);
      if (!pageId) return [];
      const page = toPage(pageId, source);
      return page ? [page] : [];
    });

  const toSummary = (page: MemoryPage): MemoryPageSummary => {
    const { content, ...rest } = page;
    const display = toMemoryDisplayTelemetry(page, now());
    return { ...rest, usefulness: display.conversionRate, confidence: display.confidence };
  };

  const emptyStats = (): MemoryStats => ({ total: 0, archived: 0 });

  const decodeCursor = (cursor?: string): MemoryKeysetCursor | undefined => {
    if (!cursor) return undefined;
    try {
      const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
      if (!Array.isArray(decoded) || decoded.length !== 2) return undefined;
      const [updatedAt, slug] = decoded;
      return typeof updatedAt === 'string' && typeof slug === 'string'
        ? [updatedAt, slug]
        : undefined;
    } catch {
      return undefined;
    }
  };

  const encodeCursor = (sort: MemoryKeysetCursor | undefined): string | undefined =>
    sort ? Buffer.from(JSON.stringify(sort), 'utf8').toString('base64') : undefined;

  const loadPagesByIds = async (ids: readonly string[]): Promise<MemoryPage[]> => {
    const canonical = [...new Set(ids)].filter(isCanonicalMemoryId);
    if (canonical.length === 0) {
      return [];
    }
    const byStoredId = new Map(canonical.map((id) => [toStoredId(id), id]));
    try {
      const response = await esClient.mget<StoredMemoryPage>(
        {
          index: MEMORY_INDEX,
          ids: [...byStoredId.keys()],
        },
        { signal }
      );
      return response.docs.flatMap((doc) => {
        const item = doc as { _id?: string; found?: boolean; _source?: StoredMemoryPage };
        if (!item.found || !item._source || !item._id) return [];
        const pageId = byStoredId.get(item._id);
        if (!pageId) return [];
        const page = toPage(pageId, item._source);
        return page ? [page] : [];
      });
    } catch (err) {
      if (isIndexNotFoundError(err)) return [];
      throw err;
    }
  };

  return {
    async list({ filter = 'all', tags } = {}) {
      try {
        const response = await runEsql(buildListQuery(MAX_LIST_SIZE), scopeFilter(filter, tags));
        const pages = rowsToPages(rowsOf(response));

        return {
          pages: pages.map(toSummary),
          stats: {
            total: pages.length,
            archived: pages.filter((page) => page.archived).length,
          },
        };
      } catch (err) {
        if (isMissingIndexError(err)) {
          return { pages: [], stats: emptyStats() };
        }
        throw err;
      }
    },

    async listPaginated({ filter = 'all', cursor, size, tags, search } = {}) {
      const pageSize = Math.min(Math.max(size ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
      const keyset = decodeCursor(cursor);
      const searchText = search?.trim() ? search.trim() : undefined;
      const scope = scopeFilter(filter, tags);

      try {
        const [pageResponse, totalResponse, archivedResponse] = await Promise.all([
          runEsql(buildPageQuery({ pageSize, search: searchText, cursor: keyset }), scope),
          runEsql(buildCountQuery({ search: searchText }), scope),
          runEsql(buildCountQuery(), archivedScope),
        ]);

        const rows = rowsOf(pageResponse);
        const pages = rowsToPages(rows);
        const total = countOf(totalResponse);
        const lastRow = rows[rows.length - 1];
        const nextCursor =
          rows.length === pageSize && pages.length === pageSize
            ? encodeCursor(lastRow.sort)
            : undefined;

        return {
          pages: pages.map(toSummary),
          stats: { total, archived: countOf(archivedResponse) },
          total,
          ...(nextCursor ? { cursor: nextCursor } : {}),
        };
      } catch (err) {
        if (isMissingIndexError(err)) {
          return { pages: [], stats: emptyStats(), total: 0 };
        }
        throw err;
      }
    },

    async retrieve({ query, size, match = 'context' } = {}) {
      const trimmed = query?.trim();
      const isSearch = trimmed !== undefined && trimmed.length > 0;
      const pageSize = size ?? (isSearch ? 50 : 150);
      logger.debug(
        `Memory retrieve start match=${match} search=${isSearch} size=${pageSize} ` +
          `space=${spaceId} query=${JSON.stringify(previewText(trimmed))}`
      );

      const searchWithQuery = async (queryText: string) => {
        if (match === 'content') {
          const response = await runEsql(
            buildContentSearchQuery({ text: queryText, size: pageSize }),
            activeScope
          );
          return rowsToPages(rowsOf(response));
        }

        // FORK and FUSE rank, but `_source` does not survive them: rank first, then load by id.
        let rankedIds: string[];
        try {
          const response = await runEsql(
            buildHybridQuery({ text: queryText, size: pageSize }),
            activeScope
          );
          rankedIds = idsOf(response);
        } catch (err) {
          if (isMissingIndexError(err)) {
            return [];
          }
          logger.warn(
            `Memory context hybrid retrieve failed, falling back to BM25: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          const response = await runEsql(
            buildDescriptionSearchQuery({ text: queryText, size: pageSize }),
            activeScope
          );
          return rowsToPages(rowsOf(response));
        }
        return loadPagesByIds(
          rankedIds.flatMap((storedId) => {
            const pageId = toPageId(storedId);
            return pageId ? [pageId] : [];
          })
        );
      };

      try {
        let pages: MemoryPage[];
        if (!isSearch || trimmed === undefined) {
          const response = await runEsql(buildRecentQuery(pageSize), activeScope);
          pages = rowsToPages(rowsOf(response));
        } else {
          pages = await searchWithQuery(trimmed);
        }
        logger.debug(
          `Memory retrieve done match=${match} hits=${pages.length}: ${formatPageRefs(pages)}`
        );
        return pages;
      } catch (err) {
        if (isMissingIndexError(err)) {
          logger.debug(`Memory retrieve index ${MEMORY_INDEX} missing — returning 0 hits`);
          return [];
        }
        throw err;
      }
    },

    async get(id) {
      if (!isCanonicalMemoryId(id)) {
        return undefined;
      }
      const storedId = toStoredId(id);
      try {
        const response = await esClient.get<StoredMemoryPage>(
          {
            index: MEMORY_INDEX,
            id: storedId,
          },
          { signal }
        );
        return response.found && response._source ? toPage(id, response._source) : undefined;
      } catch (err) {
        if (isIndexNotFoundError(err) || isNotFoundError(err)) {
          return undefined;
        }
        throw err;
      }
    },

    async getMany(ids) {
      return loadPagesByIds(ids);
    },

    async getVersioned(id) {
      if (!isCanonicalMemoryId(id)) {
        return undefined;
      }
      const storedId = toStoredId(id);
      try {
        const response = await esClient.get<StoredMemoryPage>(
          {
            index: MEMORY_INDEX,
            id: storedId,
          },
          { signal }
        );
        if (response.found && response._source) {
          const page = toPage(id, response._source);
          if (page && response._seq_no !== undefined && response._primary_term !== undefined) {
            return {
              page,
              seqNo: response._seq_no,
              primaryTerm: response._primary_term,
            };
          }
        }
        return undefined;
      } catch (err) {
        if (isIndexNotFoundError(err) || isNotFoundError(err)) {
          return undefined;
        }
        throw err;
      }
    },

    async getByName(name) {
      const slug = canonicalizeSlug(name);
      return this.get(toMemoryKiId(slug));
    },

    async upsert(page) {
      const id = toMemoryKiId(page.slug);
      const storedId = toStoredId(id);
      const existing = await this.get(id);
      const document = buildDocument(page, existing);

      await esClient.index(
        {
          index: MEMORY_INDEX,
          id: storedId,
          document,
          refresh: 'wait_for',
        },
        { signal }
      );
      return mapWrittenPage(id, document);
    },

    async create(page) {
      const id = toMemoryKiId(page.slug);
      const document = buildDocument(page, undefined);
      await esClient.index(
        {
          index: MEMORY_INDEX,
          id: toStoredId(id),
          document,
          op_type: 'create',
          refresh: 'wait_for',
        },
        { signal }
      );
      return mapWrittenPage(id, document);
    },

    async update(id, page, version) {
      return writeVersionedPage(id, page, version);
    },

    async applyCounterUpdates(updates) {
      if (updates.length === 0) {
        return;
      }

      const deltas = new Map<string, { addImp: number; addConv: number }>();
      for (const update of updates) {
        const previous = deltas.get(update.id) ?? { addImp: 0, addConv: 0 };
        deltas.set(update.id, {
          addImp: previous.addImp + update.addImp,
          addConv: previous.addConv + update.addConv,
        });
      }

      let updated = 0;
      let skipped = 0;
      let conflicts = 0;
      for (const [id, delta] of [...deltas].sort(([left], [right]) => left.localeCompare(right))) {
        let applied = false;
        for (let attempt = 0; attempt < MAX_COUNTER_UPDATE_ATTEMPTS; attempt++) {
          const versioned = await this.getVersioned(id);
          if (!versioned || versioned.page.archived) {
            skipped++;
            break;
          }

          const current = toCounterState(versioned.page.telemetry);
          const effectiveNow = Math.max(now(), current.lastTime);
          const next = applyUpdate(current, effectiveNow, delta.addImp, delta.addConv);

          try {
            // ES 9.6 rejects scripts on any index containing semantic_text; send plain fields.
            await esClient.update(
              {
                index: MEMORY_INDEX,
                id: toStoredId(id),
                if_seq_no: versioned.seqNo,
                if_primary_term: versioned.primaryTerm,
                refresh: 'wait_for',
                doc: {
                  attributes: {
                    impressions: next.impressions,
                    conversions: next.conversions,
                    last_impression_time: epochSecondsToIso(next.lastTime),
                  },
                },
              },
              { signal }
            );
            updated++;
            applied = true;
            break;
          } catch (err) {
            if (!isElasticsearchWriteConflict(err)) {
              throw err;
            }
            conflicts++;
            logger.debug(`Memory counter update conflict id=${id} attempt=${attempt + 1}`);
            if (attempt === MAX_COUNTER_UPDATE_ATTEMPTS - 1) {
              throw new Error(
                `Memory counter update exhausted ${MAX_COUNTER_UPDATE_ATTEMPTS} version conflicts`,
                { cause: err }
              );
            }
          }
        }
        if (applied) {
          logger.debug(
            `Memory counter update applied id=${id} +imp=${delta.addImp} +conv=${delta.addConv}`
          );
        }
      }
      logger.debug(
        `Memory counter updates completed total=${deltas.size} updated=${updated} ` +
          `skipped=${skipped} conflicts=${conflicts}`
      );
    },

    async archive(id, reason, user, provenance) {
      for (let attempt = 0; attempt < MAX_ARCHIVE_ATTEMPTS; attempt++) {
        const versioned = await this.getVersioned(id);
        if (!versioned) {
          return undefined;
        }
        // A retried archive of an already-archived page still answers with the page.
        if (versioned.page.archived) {
          return versioned.page;
        }
        try {
          return await this.archiveVersioned(versioned, reason, user, provenance);
        } catch (err) {
          if (!isElasticsearchWriteConflict(err)) {
            throw err;
          }
          if (attempt === MAX_ARCHIVE_ATTEMPTS - 1) {
            throw new MemoryVersionConflictError(
              `Memory archive exhausted ${MAX_ARCHIVE_ATTEMPTS} version conflicts`,
              { cause: err }
            );
          }
        }
      }
      return undefined;
    },

    async archiveVersioned(version, reason, user, provenance) {
      return writeVersionedPage(
        version.page.id,
        toArchiveWrite(version, reason, user, provenance),
        version
      );
    },

    /** Clears `archive_reason`, returning the memory to active recall. */
    async unarchive(id, user) {
      for (let attempt = 0; attempt < MAX_ARCHIVE_ATTEMPTS; attempt++) {
        const versioned = await this.getVersioned(id);
        if (!versioned) {
          return undefined;
        }
        if (!versioned.page.archived) {
          return versioned.page;
        }
        const restored: MemoryPageWrite = {
          ...toWrite(versioned.page),
          user: user ?? (versioned.page.updated_by || 'nightshift'),
        };
        try {
          return await writeVersionedPage(id, restored, versioned);
        } catch (err) {
          if (!isElasticsearchWriteConflict(err)) {
            throw err;
          }
          if (attempt === MAX_ARCHIVE_ATTEMPTS - 1) {
            throw new MemoryVersionConflictError(
              `Memory unarchive exhausted ${MAX_ARCHIVE_ATTEMPTS} version conflicts`,
              { cause: err }
            );
          }
        }
      }
      return undefined;
    },

    /** Conditional on the revision the operator read; the route answers 409 on a mismatch. */
    async delete(id, version, user) {
      const storedId = toStoredId(id);
      const versioned = await this.getVersioned(id);
      try {
        await esClient.delete(
          {
            index: MEMORY_INDEX,
            id: storedId,
            if_seq_no: version.seqNo,
            if_primary_term: version.primaryTerm,
            refresh: 'wait_for',
          },
          { signal }
        );
        logger.info(
          `Semantic Memory page deleted id=${id} title=${JSON.stringify(
            versioned?.page.title ?? '(unknown)'
          )} space=${spaceId} user=${user ?? '(unknown)'}`
        );
      } catch (err) {
        if (isElasticsearchWriteConflict(err)) {
          throw new MemoryVersionConflictError('Memory changed since it was read', {
            cause: err,
          });
        }
        if (!isIndexNotFoundError(err) && (err as { statusCode?: number }).statusCode !== 404) {
          throw err;
        }
      }
    },
  };
};
