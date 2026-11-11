/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { badRequest } from '@hapi/boom';
import { loggerMock } from '@kbn/logging-mocks';
import { MEMORY_INDEX } from '../../common/memory';
import { HALF_LIFE_SEC } from './ranking';
import {
  canonicalizeSlug,
  createMemoryPageStore,
  epochSecondsToIso,
  isCanonicalMemoryId,
  MAX_TAG_FILTER_KEYWORDS,
  toMemoryDisplayTelemetry,
  toMemoryKiId,
} from './page_store';

const T0 = 1_000_000;
const T0_ISO = epochSecondsToIso(T0);

const source = {
  '@timestamp': T0_ISO,
  type: 'memory',
  title: 'Kafka lag',
  description: 'Checkout consumer lag',
  content: 'Scale the consumer.',
  tags: ['memory', 'kafka'],
  attributes: {
    status: 'established' as const,
    slug: 'kafka-lag',
    space_id: 'space-a',
    impressions: 10,
    conversions: 3,
    last_impression_time: T0_ISO,
    categories: ['kafka'],
    references: [],
    created_at: T0_ISO,
    updated_at: T0_ISO,
    created_by: 'sre',
    updated_by: 'sre',
  },
};

interface EsqlRequest {
  query: string;
  params?: Array<Record<string, unknown>>;
  filter?: { bool: { filter?: object[]; must_not?: object[] } };
}

interface PageHit {
  _id: string;
  _source: typeof source;
  sort?: [string, string];
}

const pageResponse = (hits: PageHit[]) => ({
  columns: [
    { name: '_id', type: 'keyword' },
    { name: '_source', type: '_source' },
    { name: 'sort_updated_at', type: 'keyword' },
    { name: 'sort_slug', type: 'keyword' },
  ],
  values: hits.map(({ _id, _source, sort }) => [
    _id,
    _source,
    sort?.[0] ?? _source.attributes.updated_at,
    sort?.[1] ?? _source.attributes.slug,
  ]),
});

const idsResponse = (ids: string[]) => ({
  columns: [{ name: '_id', type: 'keyword' }],
  values: ids.map((id) => [id]),
});

const countResponse = (total: number) => ({
  columns: [{ name: 'total', type: 'long' }],
  values: [[total]],
});

const kafkaHit: PageHit = { _id: 'space-a:memory_kafka-lag', _source: source };

const isCountQuery = ({ query }: EsqlRequest) => query.includes('STATS total = COUNT(*)');

// The filter keeps only archived pages when it asserts the reason (an `exists` clause in the list).
const requiresArchived = ({ filter }: EsqlRequest) =>
  (filter?.bool.filter ?? []).some((clause) => 'exists' in clause);

// The filter drops archived pages when it negates the reason.
const excludesArchived = (request: EsqlRequest) =>
  /must_not[^\]]*archive_reason/.test(JSON.stringify(request.filter));

/** Answers pages from `rows` and counts from the filter: `active` and `archived` pages are in scope. */
const countingEsql = ({
  active,
  archived,
  rows = [],
}: {
  active: number;
  archived: number;
  rows?: PageHit[];
}) =>
  jest.fn((request: EsqlRequest) => {
    if (!isCountQuery(request)) return Promise.resolve(pageResponse(rows));
    if (requiresArchived(request)) return Promise.resolve(countResponse(archived));
    if (excludesArchived(request)) return Promise.resolve(countResponse(active));
    return Promise.resolve(countResponse(active + archived));
  });

const requestsOf = (query: jest.Mock): EsqlRequest[] =>
  query.mock.calls.map(([request]) => request as EsqlRequest);

const ARCHIVED_SCOPE = {
  bool: {
    filter: [
      { term: { tags: 'memory' } },
      { term: { 'attributes.space_id': 'space-a' } },
      { exists: { field: 'attributes.archive_reason' } },
    ],
  },
};

const createStore = (esClient: object) =>
  createMemoryPageStore({
    esClient: esClient as never,
    logger: loggerMock.create(),
    spaceId: 'space-a',
    now: () => T0,
  });

const unknownIndexError = () =>
  new errors.ResponseError({
    statusCode: 400,
    body: {
      error: { type: 'verification_exception', reason: 'Unknown index [ai-index-idx-x]' },
    },
  } as never);

describe('canonicalizeSlug / toMemoryKiId', () => {
  it('strips a memory- prefix copied from document ids', () => {
    expect(canonicalizeSlug('memory-kafka-lag')).toBe('kafka-lag');
    expect(toMemoryKiId('Kafka Lag')).toBe('memory_kafka-lag');
  });

  it('never ends a truncated slug with a hyphen, so the id stays canonical', () => {
    const id = toMemoryKiId(`${'a'.repeat(79)} b`);
    expect(id).toBe(`memory_${'a'.repeat(79)}`);
    expect(isCanonicalMemoryId(id)).toBe(true);
  });

  it.each([
    'Memory Memory Memory Pressure',
    'memory--memory-x',
    `${'a'.repeat(79)} b`,
    'Kafka Lag',
  ])('is idempotent, so the id written for %p is canonical', (title) => {
    const slug = canonicalizeSlug(title);
    expect(canonicalizeSlug(slug)).toBe(slug);
    expect(isCanonicalMemoryId(toMemoryKiId(slug))).toBe(true);
  });
});

describe('createMemoryPageStore', () => {
  const logger = loggerMock.create();

  it('lists pages with raw counters and space-scoped ids', async () => {
    const query = jest.fn().mockResolvedValue(pageResponse([kafkaHit]));
    const store = createMemoryPageStore({
      esClient: { esql: { query } } as never,
      logger,
      spaceId: 'space-a',
      now: () => T0 + HALF_LIFE_SEC,
    });

    const result = await store.list();

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].id).toBe('memory_kafka-lag');
    expect(result.pages[0].telemetry).toEqual({
      impressions: 10,
      conversions: 3,
      last_impression_time: T0_ISO,
    });
    expect(result.stats.total).toBe(1);
    expect(result.stats.archived).toBe(0);
    // The space and tag scope is the request filter, so Elasticsearch applies it as a pre-filter.
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          bool: {
            filter: [{ term: { tags: 'memory' } }, { term: { 'attributes.space_id': 'space-a' } }],
          },
        },
      }),
      expect.anything()
    );
  });

  it('reads archived pages but filters them out of an active listing', async () => {
    const archived = {
      ...source,
      attributes: { ...source.attributes, archive_reason: 'harmful' as const },
    };
    // The store delegates filtering to Elasticsearch, so the mock answers per request filter.
    // `active` nests the archive_reason check under a `must_not`; that is the difference between
    // excluding archived pages and selecting them.
    const query = jest.fn((request: EsqlRequest) =>
      Promise.resolve(
        pageResponse(
          excludesArchived(request) ? [] : [{ _id: 'space-a:memory_kafka-lag', _source: archived }]
        )
      )
    );
    const esClient = {
      esql: { query },
      get: jest.fn().mockResolvedValue({
        found: true,
        _id: 'space-a:memory_kafka-lag',
        _source: archived,
      }),
    };

    const store = createStore(esClient);

    await expect(store.list({ filter: 'active' })).resolves.toMatchObject({ pages: [] });

    // `all` has no archive_reason clause, so the archived page comes back.
    const all = await store.list({ filter: 'all' });
    expect(all.pages).toHaveLength(1);
    expect(all.pages[0]).toMatchObject({ archived: true, archive_reason: 'harmful' });

    // `archived` filters on the reason being present.
    const archivedOnly = await store.list({ filter: 'archived' });
    expect(archivedOnly.pages).toHaveLength(1);

    const got = await store.get('memory_kafka-lag');
    expect(got?.archived).toBe(true);
    expect(got?.telemetry.impressions).toBe(10);
  });

  it('sends one shared archived clause everywhere, not just an exists check', async () => {
    const query = jest.fn().mockResolvedValue(pageResponse([]));
    const store = createStore({ esql: { query } });

    await store.list({ filter: 'active' });
    expect(JSON.stringify(requestsOf(query)[0].filter)).toContain('attributes.archive_reason');
  });

  it('excludes an archived document in every query and counts it once', async () => {
    const archived = {
      ...source,
      attributes: { ...source.attributes, archive_reason: 'manual' as const },
    };
    const query = countingEsql({
      active: 0,
      archived: 1,
      rows: [{ _id: 'space-a:memory_kafka-lag', _source: archived }],
    });
    const store = createStore({
      esql: { query },
      get: jest.fn().mockResolvedValue({
        found: true,
        _id: 'space-a:memory_kafka-lag',
        _source: archived,
      }),
    });

    expect((await store.get('memory_kafka-lag'))?.archived).toBe(true);

    await store.list({ filter: 'active' });
    const listing = await store.listPaginated({ filter: 'archived' });
    await store.retrieve();

    // Active listing, archived listing (page, total, archived count) and recall all name the reason.
    const requests = requestsOf(query);
    for (const request of requests) {
      expect(JSON.stringify(request.filter)).toContain('attributes.archive_reason');
    }
    // The archived page is counted once, by the Space-wide count, not once per query.
    expect(listing.stats.archived).toBe(1);
    expect(requests.map(({ filter }) => filter)).toContainEqual(ARCHIVED_SCOPE);
  });

  it('counts every archived memory in scope whatever the list filter is', async () => {
    // The header's "N archived" describes the Archived list, which the Active/Archived/All choice
    // does not narrow. Counting inside the active listing reported 0 for every Space that had any
    // archived memory at all.
    const query = countingEsql({ active: 5, archived: 4 });
    const store = createStore({ esql: { query } });

    const totals = { active: 5, archived: 4, all: 9 };
    for (const filter of ['active', 'archived', 'all'] as const) {
      query.mockClear();
      const result = await store.listPaginated({ filter });
      // `total` follows the listing; `archived` is the Space's own count.
      expect(result.stats).toEqual({ total: totals[filter], archived: 4 });

      const requests = requestsOf(query);
      // The listing carries the active/archived choice...
      expect(JSON.stringify(requests[0].filter).includes('"attributes.archive_reason"')).toBe(
        filter !== 'all'
      );
      // ...and the archived count does not: it filters the tenancy scope itself, with no
      // `must_not` to exclude archived pages.
      expect(requests.map(({ filter: scope }) => scope)).toContainEqual(ARCHIVED_SCOPE);
    }
  });

  it('leaves the archived count at the Space, whatever the keywords select', async () => {
    const query = countingEsql({ active: 1, archived: 1 });
    const store = createStore({ esql: { query } });

    const result = await store.listPaginated({ tags: ['invoke-agent'] });

    expect(result.stats).toEqual({ total: 2, archived: 1 });
    const requests = requestsOf(query);
    // The keyword narrows the listing the total counts...
    expect(JSON.stringify(requests[0].filter)).toContain('"tags":"invoke-agent"');
    // ...and nothing else. The header's archived number describes the sidebar's Archived list,
    // which the client does not filter by keyword, so narrowing this count would describe a list
    // nobody is looking at.
    const archivedCount = requests.find(
      (request) => isCountQuery(request) && requiresArchived(request)
    );
    expect(JSON.stringify(archivedCount?.filter)).not.toContain('"tags":"invoke-agent"');
  });

  it('ANDs a lexical search on title and description without narrowing the archived count', async () => {
    const query = countingEsql({ active: 1, archived: 1 });
    const store = createStore({ esql: { query } });

    await store.listPaginated({ filter: 'active', search: 'checkout lag' });

    const requests = requestsOf(query);
    const [page] = requests;
    // One `match` per field with every term required, any field: what `multi_match` with
    // `operator: and` meant.
    expect(page.query).toContain('MATCH(title, ?text, {"operator": "AND"}) OR MATCH(description, ');
    expect(page.query).toContain('{"operator": "AND"})');
    // The text is bound, never spliced into the query.
    expect(page.query).not.toContain('checkout lag');
    expect(page.params).toEqual(expect.arrayContaining([{ text: 'checkout lag' }]));
    expect(JSON.stringify(page.filter)).toContain('"attributes.archive_reason"');
    // The header's archived count describes the whole Space, so the search does not narrow it
    // either.
    const archivedCount = requests.find(
      (request) => isCountQuery(request) && requiresArchived(request)
    );
    expect(archivedCount).toBeDefined();
    expect(JSON.stringify(archivedCount)).not.toContain('checkout lag');
  });

  it('ignores a blank search rather than filtering on whitespace', async () => {
    const query = countingEsql({ active: 1, archived: 0 });
    const store = createStore({ esql: { query } });

    await store.listPaginated({ search: '   ' });

    for (const request of requestsOf(query)) {
      expect(request.query).not.toContain('MATCH');
    }
  });

  it('paginates on a total order so no row is skipped or repeated', async () => {
    // Every row shares an `updated_at`, so the slug tiebreaker is what keeps the order total.
    // Sorting on `_id` instead is not an option: Elasticsearch rejects it
    // (`indices.id_field_data.enabled`).
    const updatedAt = '2026-01-01T00:00:00.000Z';
    const page = (ids: string[]) =>
      pageResponse(
        ids.map((id) => {
          const slug = id.replace('memory_', '');
          return {
            _id: `space-a:${id}`,
            _source: {
              ...source,
              '@timestamp': updatedAt,
              attributes: { ...source.attributes, slug, updated_at: updatedAt },
            },
          };
        })
      );
    // The mock answers by whether the request resumes from a cursor.
    const query = jest.fn((request: EsqlRequest) => {
      if (isCountQuery(request)) return Promise.resolve(countResponse(3));
      const resumes = (request.params ?? []).some((param) => 'cursorUpdatedAt' in param);
      return Promise.resolve(resumes ? page(['memory_c']) : page(['memory_a', 'memory_b']));
    });
    const store = createStore({ esql: { query } });

    const first = await store.listPaginated({ size: 2 });
    expect(first.pages.map((row) => row.id)).toEqual(['memory_a', 'memory_b']);
    expect(first.total).toBe(3);
    // A full page may have more behind it, so a cursor is offered.
    expect(first.cursor).toBeDefined();

    const second = await store.listPaginated({ size: 2, cursor: first.cursor });
    expect(second.pages.map((row) => row.id)).toEqual(['memory_c']);
    // A short page means the result set is exhausted.
    expect(second.cursor).toBeUndefined();

    // The second request must resume from the *first page's last row*, which is what keyset paging
    // means: not an offset, and not the second page's own values. The tiebreaker is the slug.
    const resumed = requestsOf(query).find(
      (request) =>
        !isCountQuery(request) && (request.params ?? []).some((p) => 'cursorUpdatedAt' in p)
    );
    expect(resumed?.params).toEqual(
      expect.arrayContaining([{ cursorUpdatedAt: updatedAt }, { cursorSlug: 'b' }])
    );
    // Together the two pages cover every id exactly once.
    expect([...first.pages, ...second.pages].map((row) => row.id)).toEqual([
      'memory_a',
      'memory_b',
      'memory_c',
    ]);
  });

  it('ignores a malformed cursor rather than failing the listing', async () => {
    const query = countingEsql({ active: 0, archived: 0 });
    const store = createStore({ esql: { query } });

    const result = await store.listPaginated({ cursor: 'not-a-cursor' });
    expect(result.pages).toEqual([]);
    expect(JSON.stringify(requestsOf(query))).not.toContain('cursorUpdatedAt');
  });

  it('rejects a cursor that decodes to the wrong shape, not just an unparseable one', async () => {
    const query = countingEsql({ active: 0, archived: 0 });
    const store = createStore({ esql: { query } });
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

    // A token of the wrong arity would resume from a partial sort key, and one carrying a nested
    // object or a number is not a keyset position at all.
    for (const cursor of [
      encode(['2026-01-01T00:00:00.000Z']),
      encode([{ at: '2026-01-01T00:00:00.000Z' }, 'kafka-lag']),
      encode([123, null]),
      Buffer.from('not json at all', 'utf8').toString('base64'),
    ]) {
      query.mockClear();
      const result = await store.listPaginated({ cursor });
      expect(result.pages).toEqual([]);
      expect(JSON.stringify(requestsOf(query))).not.toContain('cursorUpdatedAt');
    }
  });

  it('takes total and stats from the whole filtered set, not from the page slice', async () => {
    // The page holds one row out of many, so if the header numbers came from the page slice they
    // would shrink as the operator scrolls.
    const query = countingEsql({ active: 125, archived: 12, rows: [kafkaHit] });
    const store = createStore({ esql: { query } });

    const result = await store.listPaginated({ size: 25 });

    expect(result.pages).toHaveLength(1);
    expect(result.total).toBe(137);
    expect(result.stats).toEqual({
      total: 137,
      archived: 12,
    });
  });

  it('ANDs one exact term per canonical keyword', async () => {
    const query = jest.fn().mockResolvedValue(pageResponse([]));
    const store = createStore({ esql: { query } });

    await store.list({ filter: 'active', tags: ['invoke-agent', 'cart-cache'] });

    expect(requestsOf(query)[0].filter?.bool.filter).toEqual([
      { term: { tags: 'memory' } },
      { term: { 'attributes.space_id': 'space-a' } },
      expect.objectContaining({ bool: { must_not: expect.anything() } }),
      { term: { tags: 'invoke-agent' } },
      { term: { tags: 'cart-cache' } },
    ]);
  });

  it('canonicalizes the selected keywords and drops duplicates', async () => {
    const query = jest.fn().mockResolvedValue(pageResponse([]));
    const store = createStore({ esql: { query } });

    await store.list({ tags: ['Invoke Agent', 'invoke_agent'] });

    expect(requestsOf(query)[0].filter?.bool.filter?.[2]).toEqual({
      term: { tags: 'invoke-agent' },
    });
  });

  it('counts the filtered set in the stats, so the header cannot drift from the rows', async () => {
    const query = countingEsql({ active: 2, archived: 0 });
    const store = createStore({ esql: { query } });

    const result = await store.listPaginated({ tags: ['kafka'] });

    expect(result.total).toBe(2);
    expect(result.stats).toEqual({ total: 2, archived: 0 });
    // The listing request carries the tag clause.
    expect(JSON.stringify(requestsOf(query)[0].filter)).toContain('"tags":"kafka"');
  });

  it('leaves the query untagged when no keyword was selected', async () => {
    const query = jest.fn().mockResolvedValue(pageResponse([]));
    const store = createStore({ esql: { query } });

    await store.list({ tags: [] });

    expect(requestsOf(query)[0].filter).toEqual({
      bool: {
        filter: [{ term: { tags: 'memory' } }, { term: { 'attributes.space_id': 'space-a' } }],
      },
    });
  });

  it('refuses more keywords than the cap, rather than silently narrowing the AND', async () => {
    const query = jest.fn().mockResolvedValue(pageResponse([]));
    const store = createStore({ esql: { query } });

    // More keywords than the cap is refused rather than answered for the first
    // `MAX_TAG_FILTER_KEYWORDS` of them: a silently narrowed AND filter returns
    // rows and a total that describe a question the caller never asked.
    const tooManyKeywords = Array.from(
      { length: MAX_TAG_FILTER_KEYWORDS + 1 },
      (_, i) => `keyword ${i}`
    );
    await expect(store.list({ tags: tooManyKeywords })).rejects.toThrow(
      badRequest(
        `A Semantic Memory tag filter may name at most ${MAX_TAG_FILTER_KEYWORDS} keywords`
      )
    );
    await expect(
      store.list({
        tags: Array.from({ length: MAX_TAG_FILTER_KEYWORDS }, (_, i) => `keyword ${i}`),
      })
    ).resolves.toBeDefined();
  });

  it.each([
    ['an ES|QL unknown index (400)', unknownIndexError],
    [
      'a 404 index_not_found_exception',
      () =>
        new errors.ResponseError({
          statusCode: 404,
          body: { error: { type: 'index_not_found_exception' } },
        } as never),
    ],
  ])(
    'reports empty stats rather than failing when the index does not exist yet: %s',
    async (_name, makeError) => {
      const query = jest.fn().mockRejectedValue(makeError());
      const store = createStore({ esql: { query } });

      // The index is created lazily, so an empty Semantic Memory is a missing index from
      // Elasticsearch rather than an error the operator should see.
      await expect(store.listPaginated()).resolves.toEqual({
        pages: [],
        stats: { total: 0, archived: 0 },
        total: 0,
      });
    }
  );

  it('decays display telemetry without rewriting stored last_impression_time', () => {
    const page = {
      id: 'memory_kafka-lag',
      slug: 'kafka-lag',
      title: 'Kafka lag',
      content: 'Scale the consumer.',
      tags: ['memory'],
      archived: false as const,
      categories: [],
      references: [],
      created_at: T0_ISO,
      updated_at: T0_ISO,
      created_by: 'sre',
      updated_by: 'sre',
      telemetry: {
        impressions: 10,
        conversions: 3,
        last_impression_time: T0_ISO,
      },
    };

    const display = toMemoryDisplayTelemetry(page, T0 + HALF_LIFE_SEC);
    expect(display.last_impression_time).toBe(T0_ISO);
    expect(display.impressions).toBeCloseTo(5, 10);
    expect(display.conversions).toBeCloseTo(1.5, 10);
  });

  it('upserts with a space-prefixed stored id and writes space metadata', async () => {
    const esClient = {
      get: jest
        .fn()
        .mockRejectedValue(new errors.ResponseError({ statusCode: 404, body: {} } as never)),
      index: jest.fn().mockResolvedValue({}),
    };

    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    const page = await store.upsert({
      slug: 'kafka-lag',
      title: 'Kafka lag',
      content: 'Scale the consumer.',
      tags: ['memory', 'kafka'],
      categories: [],
      references: [],

      user: 'sre',
    });

    expect(esClient.index).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'space-a:memory_kafka-lag',
        document: expect.objectContaining({
          tags: ['memory', 'kafka'],
          attributes: expect.objectContaining({
            space_id: 'space-a',
            impressions: 0,
            conversions: 0,
          }),
        }),
      }),
      expect.anything()
    );
    expect(page.id).toBe('memory_kafka-lag');
    expect(page.telemetry.impressions).toBe(0);
    expect(esClient.index.mock.calls[0][0].document.attributes.space_id).toBe('space-a');
  });

  it('writes an existing canonical in place with optimistic concurrency', async () => {
    const esClient = { index: jest.fn().mockResolvedValue({}) };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });
    const existing = {
      id: 'memory_kafka-lag',
      slug: 'kafka-lag',
      title: 'Kafka lag',
      content: 'Old content.',
      tags: ['memory'],
      archived: false,
      categories: [],
      references: [],
      created_at: T0_ISO,
      updated_at: T0_ISO,
      created_by: 'sre',
      updated_by: 'sre',
      telemetry: {
        impressions: 10,
        conversions: 3,
        last_impression_time: T0_ISO,
      },
    };

    await store.update(
      existing.id,
      {
        slug: existing.slug,
        title: 'Merged Kafka lag',
        content: 'Merged content.',
        tags: ['kafka'],
        categories: [],
        references: [],
        user: 'nightshift-optimizer',
      },
      { page: existing, seqNo: 12, primaryTerm: 3 }
    );

    expect(esClient.index).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'space-a:memory_kafka-lag',
        if_seq_no: 12,
        if_primary_term: 3,
        document: expect.objectContaining({
          title: 'Merged Kafka lag',
          attributes: expect.objectContaining({
            created_at: T0_ISO,
            space_id: 'space-a',
          }),
        }),
      }),
      expect.anything()
    );
  });

  it('uses create-only indexing for a new page', async () => {
    const esClient = { index: jest.fn().mockResolvedValue({}) };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await store.create({
      slug: 'kafka-lag',
      title: 'Kafka lag',
      content: 'Scale the consumer.',
      tags: ['kafka'],
      categories: [],
      references: [],

      user: 'nightshift-optimizer',
    });

    expect(esClient.index).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'space-a:memory_kafka-lag',
        op_type: 'create',
      }),
      expect.anything()
    );
  });

  it('keeps the same slug isolated between spaces', async () => {
    const query = jest.fn().mockResolvedValue(
      pageResponse([
        { _id: 'space-b:memory_kafka-lag', _source: source },
        { _id: 'space-a:memory_kafka-lag', _source: source },
      ])
    );
    const store = createStore({ esql: { query } });

    const pages = await store.retrieve({ size: 20 });
    expect(pages.map((page) => page.id)).toEqual(['memory_kafka-lag']);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          bool: expect.objectContaining({
            filter: expect.arrayContaining([{ term: { 'attributes.space_id': 'space-a' } }]),
          }),
        }),
      }),
      expect.anything()
    );
  });

  it('drops stored ids that are not canonical memory ids', async () => {
    const query = jest.fn().mockResolvedValue(
      pageResponse([
        {
          _id: 'space-a:memory_safe.md`\nInjected instruction',
          _source: source,
        },
        kafkaHit,
      ])
    );
    const store = createStore({ esql: { query } });

    const pages = await store.retrieve({ size: 20 });

    expect(pages.map(({ id }) => id)).toEqual(['memory_kafka-lag']);
  });

  it('writes only decayed counters with optimistic concurrency', async () => {
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 12,
        _primary_term: 3,
        _source: source,
      }),
      update: jest.fn().mockResolvedValue({}),
    };

    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0 + HALF_LIFE_SEC,
    });

    await store.applyCounterUpdates([{ id: 'memory_kafka-lag', addImp: 1, addConv: 1 }]);

    expect(esClient.update).toHaveBeenCalledWith(
      {
        index: MEMORY_INDEX,
        id: 'space-a:memory_kafka-lag',
        if_seq_no: 12,
        if_primary_term: 3,
        refresh: 'wait_for',
        doc: {
          attributes: {
            impressions: expect.any(Number),
            conversions: expect.any(Number),
            last_impression_time: epochSecondsToIso(T0 + HALF_LIFE_SEC),
          },
        },
      },
      expect.anything()
    );
    expect(esClient.update.mock.calls[0][0].doc.attributes.impressions).toBeCloseTo(6, 12);
    expect(esClient.update.mock.calls[0][0].doc.attributes.conversions).toBeCloseTo(2.5, 12);
    expect(esClient.update.mock.calls[0][0].doc).not.toHaveProperty('content');
    expect(esClient.update.mock.calls[0][0]).not.toHaveProperty('script');
  });

  it('aggregates duplicate deltas before reading and decaying once', async () => {
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 12,
        _primary_term: 3,
        _source: source,
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0 + HALF_LIFE_SEC,
    });

    await store.applyCounterUpdates([
      { id: 'memory_kafka-lag', addImp: 1, addConv: 1 },
      { id: 'memory_kafka-lag', addImp: 1, addConv: 0 },
    ]);

    expect(esClient.get).toHaveBeenCalledTimes(1);
    expect(esClient.update).toHaveBeenCalledTimes(1);
    const written = esClient.update.mock.calls[0][0].doc.attributes;
    expect(written.impressions).toBeCloseTo(7, 12);
    expect(written.conversions).toBeCloseTo(2.5, 12);
    expect(written.last_impression_time).toBe(epochSecondsToIso(T0 + HALF_LIFE_SEC));
  });

  it('rereads and recomputes after a conflict so both logical increments survive', async () => {
    const concurrentSource = {
      ...source,
      attributes: {
        ...source.attributes,
        impressions: 6,
        conversions: 1.5,
        last_impression_time: epochSecondsToIso(T0 + HALF_LIFE_SEC),
      },
    };
    const esClient = {
      get: jest
        .fn()
        .mockResolvedValueOnce({
          found: true,
          _seq_no: 12,
          _primary_term: 3,
          _source: source,
        })
        .mockResolvedValueOnce({
          found: true,
          _seq_no: 13,
          _primary_term: 3,
          _source: concurrentSource,
        }),
      update: jest.fn().mockRejectedValueOnce({ statusCode: 409 }).mockResolvedValueOnce({}),
    };

    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0 + HALF_LIFE_SEC,
    });

    await store.applyCounterUpdates([{ id: 'memory_kafka-lag', addImp: 1, addConv: 0 }]);

    expect(esClient.get).toHaveBeenCalledTimes(2);
    expect(esClient.update).toHaveBeenCalledTimes(2);
    expect(esClient.update.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        if_seq_no: 13,
        if_primary_term: 3,
        doc: {
          attributes: {
            impressions: 7,
            conversions: 1.5,
            last_impression_time: epochSecondsToIso(T0 + HALF_LIFE_SEC),
          },
        },
      })
    );
  });

  it('noops archived and missing pages', async () => {
    const archived = {
      ...source,
      attributes: { ...source.attributes, archive_reason: 'harmful' as const },
    };
    const esClient = {
      get: jest
        .fn()
        .mockResolvedValueOnce({
          found: true,
          _seq_no: 12,
          _primary_term: 3,
          _source: archived,
        })
        .mockRejectedValueOnce(new errors.ResponseError({ statusCode: 404, body: {} } as never)),
      update: jest.fn(),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await store.applyCounterUpdates([
      { id: 'memory_archived', addImp: 1, addConv: 1 },
      { id: 'memory_missing', addImp: 1, addConv: 1 },
    ]);

    expect(esClient.get).toHaveBeenCalledTimes(2);
    expect(esClient.update).not.toHaveBeenCalled();
  });

  it('throws a non-conflict update failure without retrying', async () => {
    const failure = Object.assign(new Error('unavailable'), { statusCode: 503 });
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 12,
        _primary_term: 3,
        _source: source,
      }),
      update: jest.fn().mockRejectedValue(failure),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await expect(
      store.applyCounterUpdates([{ id: 'memory_kafka-lag', addImp: 1, addConv: 1 }])
    ).rejects.toBe(failure);
    expect(esClient.get).toHaveBeenCalledTimes(1);
    expect(esClient.update).toHaveBeenCalledTimes(1);
  });

  it('throws visibly after three counter update conflicts', async () => {
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 12,
        _primary_term: 3,
        _source: source,
      }),
      update: jest.fn().mockRejectedValue({ statusCode: 409 }),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await expect(
      store.applyCounterUpdates([{ id: 'memory_kafka-lag', addImp: 1, addConv: 1 }])
    ).rejects.toThrow('Memory counter update exhausted 3 version conflicts');
    expect(esClient.get).toHaveBeenCalledTimes(3);
    expect(esClient.update).toHaveBeenCalledTimes(3);
  });

  it('does not regress last_impression_time when the stored timestamp is newer', async () => {
    const futureTime = T0 + 60;
    const futureSource = {
      ...source,
      attributes: {
        ...source.attributes,
        last_impression_time: epochSecondsToIso(futureTime),
      },
    };
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 12,
        _primary_term: 3,
        _source: futureSource,
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await store.applyCounterUpdates([{ id: 'memory_kafka-lag', addImp: 1, addConv: 1 }]);

    expect(esClient.update.mock.calls[0][0].doc.attributes).toEqual({
      impressions: 11,
      conversions: 4,
      last_impression_time: epochSecondsToIso(futureTime),
    });
  });

  it('retrieves browse candidates without a query and search hits with one', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(pageResponse([kafkaHit]))
      .mockResolvedValueOnce(idsResponse(['space-a:memory_kafka-lag']));
    const mget = jest.fn().mockResolvedValue({
      docs: [{ _id: 'space-a:memory_kafka-lag', found: true, _source: source }],
    });
    const store = createStore({ esql: { query }, mget });

    const browsed = await store.retrieve({ size: 20 });
    expect(browsed).toHaveLength(1);
    const [browse] = requestsOf(query);
    expect(browse.query).toContain('SORT @timestamp DESC NULLS LAST');
    expect(browse.query).toContain('LIMIT 20');
    expect(browse.filter).toEqual({
      bool: {
        filter: [{ term: { tags: 'memory' } }, { term: { 'attributes.space_id': 'space-a' } }],
        must_not: [{ exists: { field: 'attributes.archive_reason' } }],
      },
    });

    const searched = await store.retrieve({ query: 'checkout lag', size: 50 });
    expect(searched.map(({ id }) => id)).toEqual(['memory_kafka-lag']);
    const hybrid = requestsOf(query)[1];
    // A lexical and a semantic branch, fused. `MATCH` leads each branch, ahead of its `LIMIT`.
    expect(hybrid.query).toContain('FORK (WHERE MATCH(description, ?text) | SORT _score DESC');
    expect(hybrid.query).toContain('(WHERE MATCH(description.semantic, ');
    expect(hybrid.query).toContain('FUSE RRF WITH {"rank_constant": 60}');
    expect(hybrid.query).not.toContain('checkout lag');
    expect(hybrid.params).toEqual(
      expect.arrayContaining([{ text: 'checkout lag' }, { window: 50 }])
    );
    expect(hybrid.filter).toEqual(browse.filter);
    // `_source` does not survive FUSE, so the ranked ids are loaded by id.
    expect(mget).toHaveBeenCalledWith(
      { index: MEMORY_INDEX, ids: ['space-a:memory_kafka-lag'] },
      expect.anything()
    );
  });

  it('falls back to BM25 when a semantic retriever returns a generic 404', async () => {
    const query = jest
      .fn()
      .mockRejectedValueOnce({
        statusCode: 404,
        meta: { body: { error: { type: 'resource_not_found_exception' } } },
      })
      .mockResolvedValueOnce(pageResponse([kafkaHit]));
    const store = createStore({ esql: { query } });

    await expect(store.retrieve({ query: 'checkout lag', size: 50 })).resolves.toEqual([
      expect.objectContaining({ id: 'memory_kafka-lag' }),
    ]);
    expect(query).toHaveBeenCalledTimes(2);
    const fallback = requestsOf(query)[1];
    expect(fallback.query).toContain('MATCH(description, ?text)');
    expect(fallback.query).toContain('SORT _score DESC');
    expect(fallback.query).not.toContain('FORK');
  });

  it('returns no hits for an index_not_found_exception without attempting BM25', async () => {
    const query = jest.fn().mockRejectedValue(unknownIndexError());
    const store = createStore({ esql: { query } });

    await expect(store.retrieve({ query: 'checkout lag', size: 50 })).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('retrieves catalog duplicates against title and content, not context', async () => {
    const query = jest.fn().mockResolvedValue(pageResponse([kafkaHit]));
    const store = createStore({ esql: { query } });

    await store.retrieve({ query: 'Checkout Redis', size: 5, match: 'content' });
    const [request] = requestsOf(query);
    expect(request.query).toContain('MATCH(title, ?text) OR MATCH(content, ');
    expect(request.query).not.toContain('description');
    expect(request.query).toContain('LIMIT 5');
    expect(request.params).toEqual(expect.arrayContaining([{ text: 'Checkout Redis' }]));
  });

  it('returns the hybrid hits in rank order and drops ranked ids that no longer exist', async () => {
    const other = {
      ...source,
      title: 'Redis eviction',
      attributes: { ...source.attributes, slug: 'redis' },
    };
    const query = jest
      .fn()
      .mockResolvedValue(
        idsResponse(['space-a:memory_redis', 'space-a:memory_gone', 'space-a:memory_kafka-lag'])
      );
    // `mget` answers in the order it was asked, so ranking survives the load.
    const mget = jest.fn().mockResolvedValue({
      docs: [
        { _id: 'space-a:memory_redis', found: true, _source: other },
        { _id: 'space-a:memory_gone', found: false },
        { _id: 'space-a:memory_kafka-lag', found: true, _source: source },
      ],
    });
    const store = createStore({ esql: { query }, mget });

    const pages = await store.retrieve({ query: 'cache', size: 10 });

    expect(pages.map(({ id }) => id)).toEqual(['memory_redis', 'memory_kafka-lag']);
    expect(mget.mock.calls[0][0].ids).toEqual([
      'space-a:memory_redis',
      'space-a:memory_gone',
      'space-a:memory_kafka-lag',
    ]);
  });

  it('does not mask a failure to load the ranked documents with a BM25 fallback', async () => {
    const query = jest.fn().mockResolvedValue(idsResponse(['space-a:memory_kafka-lag']));
    const mget = jest.fn().mockRejectedValue(new Error('mget failed'));
    const store = createStore({ esql: { query }, mget });

    await expect(store.retrieve({ query: 'cache', size: 10 })).rejects.toThrow('mget failed');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('upserts the task into context and does not write search_embedding', async () => {
    const esClient = {
      get: jest
        .fn()
        .mockRejectedValue(new errors.ResponseError({ statusCode: 404, body: {} } as never)),
      index: jest.fn().mockResolvedValue({}),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await store.upsert({
      slug: 'kafka-lag',
      title: 'Kafka lag',
      content: 'Scale the consumer.',
      context: 'why is checkout slow?',
      tags: ['kafka'],
      categories: [],
      references: [],

      user: 'sre',
    });

    expect(esClient.index).toHaveBeenCalledWith(
      expect.objectContaining({
        index: MEMORY_INDEX,
        document: expect.objectContaining({
          description: 'why is checkout slow?',
        }),
      }),
      expect.anything()
    );
    expect(esClient.index.mock.calls[0][0].document.search_embedding).toBeUndefined();
  });

  it('stamps archive_reason and keeps context on the archived doc', async () => {
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _id: 'space-a:memory_kafka-lag',
        _seq_no: 4,
        _primary_term: 2,
        _source: {
          ...source,
          description: 'why is checkout slow?',
          attributes: {
            ...source.attributes,
            source: 'Merged from memories: memory_a',
            merged_from: ['memory_a'],
          },
        },
      }),
      index: jest.fn().mockResolvedValue({}),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await store.archive('memory_kafka-lag', 'merged');

    expect(esClient.index).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'space-a:memory_kafka-lag',
        if_seq_no: 4,
        if_primary_term: 2,
        document: expect.objectContaining({
          description: 'why is checkout slow?',
          attributes: expect.objectContaining({
            archive_reason: 'merged',
            source: 'Merged from memories: memory_a',
            merged_from: ['memory_a'],
          }),
        }),
      }),
      expect.anything()
    );
  });

  it('archiving an already archived page is a no-op that returns the page', async () => {
    const archivedSource = {
      ...source,
      attributes: { ...source.attributes, archive_reason: 'manual' as const },
    };
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 4,
        _primary_term: 2,
        _source: archivedSource,
      }),
      index: jest.fn().mockResolvedValue({}),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    const page = await store.archive('memory_kafka-lag', 'merged');

    expect(page?.archived).toBe(true);
    expect(esClient.index).not.toHaveBeenCalled();
  });

  it('unarchiving an active page is a no-op that returns the page', async () => {
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 4,
        _primary_term: 2,
        _source: source,
      }),
      index: jest.fn().mockResolvedValue({}),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    const page = await store.unarchive('memory_kafka-lag');

    expect(page?.archived).toBe(false);
    expect(esClient.index).not.toHaveBeenCalled();
  });

  it('logs a delete at info with the user, title, and space', async () => {
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 4,
        _primary_term: 2,
        _source: source,
      }),
      delete: jest.fn().mockResolvedValue({}),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await store.delete('memory_kafka-lag', { seqNo: 4, primaryTerm: 2 }, 'alice');

    expect(esClient.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'space-a:memory_kafka-lag',
        if_seq_no: 4,
        if_primary_term: 2,
      }),
      expect.anything()
    );
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).toContain('user=alice');
    expect(logged).toContain('space=space-a');
    expect(logged).toContain('Kafka lag');
  });

  it('records the requesting user as updated_by on archive and restore', async () => {
    const archivedSource = {
      ...source,
      attributes: { ...source.attributes, archive_reason: 'manual' as const },
    };
    const esClient = {
      get: jest
        .fn()
        .mockResolvedValueOnce({ found: true, _seq_no: 4, _primary_term: 2, _source: source })
        .mockResolvedValueOnce({
          found: true,
          _seq_no: 5,
          _primary_term: 2,
          _source: archivedSource,
        }),
      index: jest.fn().mockResolvedValue({}),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await store.archive('memory_kafka-lag', 'manual', 'alice');
    await store.unarchive('memory_kafka-lag', 'bob');

    const [archiveCall, restoreCall] = esClient.index.mock.calls;
    expect(archiveCall[0].document.attributes).toMatchObject({
      updated_by: 'alice',
      archive_reason: 'manual',
    });
    expect(restoreCall[0].document.attributes).toMatchObject({ updated_by: 'bob' });
  });

  it('archives an exact supplied version without rereading', async () => {
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 4,
        _primary_term: 2,
        _source: source,
      }),
      index: jest.fn().mockResolvedValue({}),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });
    const version = await store.getVersioned('memory_kafka-lag');
    if (!version) {
      throw new Error('Expected versioned page');
    }
    esClient.get.mockClear();

    await store.archiveVersioned(version, 'merged');

    expect(esClient.get).not.toHaveBeenCalled();
    expect(esClient.index).toHaveBeenCalledTimes(1);
    expect(esClient.index).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'space-a:memory_kafka-lag',
        if_seq_no: 4,
        if_primary_term: 2,
        document: expect.objectContaining({
          attributes: expect.objectContaining({
            archive_reason: 'merged',
          }),
        }),
      }),
      expect.anything()
    );
  });

  it('does not reread or retry when exact-version archival conflicts', async () => {
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 4,
        _primary_term: 2,
        _source: source,
      }),
      index: jest.fn().mockRejectedValue({ statusCode: 409 }),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });
    const version = await store.getVersioned('memory_kafka-lag');
    if (!version) {
      throw new Error('Expected versioned page');
    }
    esClient.get.mockClear();

    await expect(store.archiveVersioned(version, 'merged')).rejects.toEqual({ statusCode: 409 });
    expect(esClient.get).not.toHaveBeenCalled();
    expect(esClient.index).toHaveBeenCalledTimes(1);
  });

  it('retries harmful archive conflicts using the latest page fields and version', async () => {
    const latest = {
      ...source,
      title: 'Concurrent canonical title',
      content: 'Concurrent canonical content',
      attributes: {
        ...source.attributes,
        impressions: 12,
        conversions: 5,
      },
    };
    const esClient = {
      get: jest
        .fn()
        .mockResolvedValueOnce({
          found: true,
          _seq_no: 4,
          _primary_term: 2,
          _source: source,
        })
        .mockResolvedValueOnce({
          found: true,
          _seq_no: 5,
          _primary_term: 2,
          _source: latest,
        }),
      index: jest.fn().mockRejectedValueOnce({ statusCode: 409 }).mockResolvedValueOnce({}),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await store.archive('memory_kafka-lag', 'harmful');

    expect(esClient.index).toHaveBeenCalledTimes(2);
    expect(esClient.index.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        if_seq_no: 5,
        if_primary_term: 2,
        document: expect.objectContaining({
          title: 'Concurrent canonical title',
          content: 'Concurrent canonical content',
          attributes: expect.objectContaining({
            impressions: 12,
            conversions: 5,
          }),
        }),
      })
    );
  });

  it('throws after exhausting archive version conflicts', async () => {
    const esClient = {
      get: jest.fn().mockResolvedValue({
        found: true,
        _seq_no: 4,
        _primary_term: 2,
        _source: source,
      }),
      index: jest.fn().mockRejectedValue({ statusCode: 409 }),
    };
    const store = createMemoryPageStore({
      esClient: esClient as never,
      logger,
      spaceId: 'space-a',
      now: () => T0,
    });

    await expect(store.archive('memory_kafka-lag', 'harmful')).rejects.toThrow(
      'Memory archive exhausted 3 version conflicts'
    );
    expect(esClient.index).toHaveBeenCalledTimes(3);
  });
});
