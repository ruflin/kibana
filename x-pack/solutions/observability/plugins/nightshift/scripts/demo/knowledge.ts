/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  DECISION_TREE_AI_INDEX_DEST,
  MEMORY_INDEX,
  type CortexEntityType,
  type CortexPageStatus,
} from '@kbn/nightshift-investigations-plugin/common';
import {
  extractMermaid,
  parseMermaidDecisionTree,
  symptomTreeId,
} from '@kbn/nightshift-decision-trees';
import { DEMO_TAG } from './dataset';
import { kibanaRequest } from './http';
import type { DemoContext } from './steps';

/** Prefix on every demo slug, so cleanup can tell demo Cortex pages from real ones. */
const DEMO_SLUG_PREFIX = 'demo-';

/** Tag on decision tree documents. Same value as `DECISION_TREE_TAG` in the investigations plugin, which its common index does not export. */
const DECISION_TREE_TAG = 'decision-tree';

interface CortexPageInput {
  entityType: CortexEntityType;
  slug: string;
  title: string;
  description: string;
  content: string;
  status: CortexPageStatus;
}

const CORTEX_PAGES: CortexPageInput[] = [
  {
    entityType: 'service',
    slug: 'demo-fraud-check',
    title: 'fraud-check',
    description: 'Fraud gateway service in the claims pipeline.',
    status: 'established',
    content: [
      '## Role',
      '',
      'fraud-check scores each claim before payment-processor pays it. claim-intake calls it synchronously.',
      '',
      '## Known failure modes',
      '',
      '- Upstream fraud gateway timeouts when it misses its deadline. claim-intake then stalls.',
      '- Redis and Kafka messages in the same window are unrelated: fraud-check does not call them on the request path.',
    ].join('\n'),
  },
  {
    entityType: 'topic',
    slug: 'demo-claim-flow',
    title: 'Claim processing flow',
    description: 'How a claim moves through the claims pipeline.',
    status: 'established',
    content: [
      '## Flow',
      '',
      '1. claim-intake receives the claim and calls policy-lookup and fraud-check.',
      '2. payment-processor pays claims that pass fraud-check, using postgres for the ledger.',
      '3. notification-dispatch tells the claimant the outcome.',
      '',
      'A slow fraud-check slows every claim, because claim-intake waits for it.',
    ].join('\n'),
  },
  {
    entityType: 'runbook',
    slug: 'demo-fraud-gateway-timeouts',
    title: 'Fraud gateway timeouts runbook',
    description: 'First steps when fraud-check times out.',
    status: 'tentative',
    content: [
      '1. Check the fraud-check error rate and the upstream gateway latency on the dashboard.',
      '2. If the gateway is overloaded, scale it out before restarting claim-intake.',
      '3. Do not act on Redis or Kafka warnings alone: confirm the fraud-check timeouts first.',
    ].join('\n'),
  },
];

interface MemoryPageInput {
  slug: string;
  title: string;
  context: string;
  content: string;
  categories: string[];
  tags: string[];
}

const MEMORY_PAGES: MemoryPageInput[] = [
  {
    slug: 'demo-fraud-check-timeouts-under-load',
    title: 'fraud-check times out under load',
    context: 'Past incident: fraud-check gateway timeouts stalled claim intake.',
    content:
      'When fraud-check gateway timeouts reach about 50% of requests, claim-intake stalls within minutes. Check fraud-check upstream latency before restarting claim-intake, because a restart does not clear the upstream overload.',
    categories: ['incident', 'fraud-check'],
    tags: ['claims', 'fraud-check', 'timeouts'],
  },
  {
    slug: 'demo-redis-kafka-noise-in-fraud-incidents',
    title: 'Redis and Kafka noise during fraud incidents',
    context: 'Recurring noise in fraud-check incidents that is not the cause.',
    content:
      'Redis connection timeouts and Kafka consumer lag appear during fraud-check incidents. Both were unrelated in two past incidents: fraud-check fails before it calls either. Do not open a Redis or Kafka investigation from these warnings alone.',
    categories: ['noise', 'fraud-check'],
    tags: ['claims', 'redis', 'kafka'],
  },
];

const DECISION_TREE = {
  symptom: 'demo-fraud-gateway-timeouts',
  title: 'Fraud gateway timeouts',
  summary: 'Seeded demo tree for the claims pipeline.',
  description:
    'Claim intake slows when fraud-check misses its deadline. This tree was confirmed in a past incident.',
  diagram: [
    'flowchart TD',
    '    S1([Claim intake slow with fraud-check errors]) -->|✅| E1[Query fraud-check error logs]',
    '    E1 -->|✅| D1{{Gateway timeouts in fraud-check?}}',
    '    D1 -->|✅ yes| E2[Check fraud gateway upstream latency]',
    '    D1 -->|no| E3[Search Redis and Kafka logs]',
    '    E2 -->|✅| D2{{Upstream latency above deadline?}}',
    '    D2 -->|✅ yes| X1((Fraud gateway overloaded))',
    '    D2 -->|no| X2((Check fraud-check pod health))',
    '    E3 --> X3((Redis and Kafka noise, not related))',
  ].join('\n'),
  evidenceGathererMetadata: [
    'E1: service.name fraud-check with messages containing deadline or Upstream timeout',
    'E2: fraud gateway upstream latency and error rate',
    'E3: Redis and Kafka messages in the same window',
  ],
};

const iso = (): string => new Date().toISOString();

/** Writes the Cortex pages, the memory pages and the decision tree that the knowledge pages show. */
export const seedKnowledge = async (ctx: DemoContext): Promise<void> => {
  for (const page of CORTEX_PAGES) {
    await upsertCortexPage(ctx, page);
  }
  ctx.log.info(`Wrote ${CORTEX_PAGES.length} Cortex pages`);

  for (const page of MEMORY_PAGES) {
    await writeMemoryPage(ctx, page);
  }
  ctx.log.info(`Wrote ${MEMORY_PAGES.length} memory pages`);

  await writeDecisionTree(ctx);
  ctx.log.info(`Wrote decision tree ${DECISION_TREE.symptom}`);
};

/**
 * Removes the demo Cortex pages (archived, since the Cortex API has no hard delete), the demo
 * memory pages and the demo decision tree. Only documents tagged or slugged as demo are touched.
 */
export const cleanKnowledge = async (ctx: DemoContext): Promise<void> => {
  await archiveDemoCortexPages(ctx);

  await ctx.esClient.deleteByQuery({
    index: MEMORY_INDEX,
    ignore_unavailable: true,
    refresh: true,
    conflicts: 'proceed',
    query: demoDocumentQuery(ctx),
  });
  await ctx.esClient.deleteByQuery({
    index: DECISION_TREE_AI_INDEX_DEST,
    ignore_unavailable: true,
    refresh: true,
    conflicts: 'proceed',
    query: demoDocumentQuery(ctx),
  });
  ctx.log.info('Deleted demo memory pages and decision tree');
};

/** Matches only the demo documents in the current space. */
const demoDocumentQuery = (ctx: DemoContext) => ({
  bool: {
    filter: [
      { term: { tags: DEMO_TAG } },
      { term: { 'attributes.space_id': ctx.connection.space } },
    ],
  },
});

interface CortexPageResponse {
  page: { id: string; version?: string };
}

const cortexPageId = (page: CortexPageInput): string =>
  `cortex_${page.entityType}_${page.slug}`.slice(0, 512);

const cortexPagePath = (id: string): string =>
  `/internal/nightshift/cortex/pages/${encodeURIComponent(id)}`;

/** Creates the page, or overwrites it when it exists (including archived), so re-runs are safe. */
const upsertCortexPage = async (ctx: DemoContext, page: CortexPageInput): Promise<void> => {
  const id = cortexPageId(page);
  const existing = await kibanaRequest<CortexPageResponse>(
    ctx.connection,
    'GET',
    cortexPagePath(id)
  );
  const body = {
    entity_type: page.entityType,
    slug: page.slug,
    title: page.title,
    description: page.description,
    content: page.content,
    status: page.status,
  };

  if (existing.status === 200) {
    const response = await kibanaRequest(
      ctx.connection,
      'PUT',
      '/internal/nightshift/cortex/pages',
      {
        ...body,
        version: existing.data.page.version,
      }
    );
    if (response.status >= 300) {
      throw new Error(`Failed to update Cortex page ${id} (HTTP ${response.status})`);
    }
    return;
  }

  const response = await kibanaRequest(
    ctx.connection,
    'POST',
    '/internal/nightshift/cortex/pages',
    body
  );
  if (response.status >= 300) {
    throw new Error(`Failed to create Cortex page ${id} (HTTP ${response.status})`);
  }
};

interface CortexListResponse {
  pages: Array<{ id: string; entity_type: CortexEntityType; status: CortexPageStatus }>;
}

/** Archives every active demo Cortex page. Archived pages stay restorable, so this is soft. */
const archiveDemoCortexPages = async (ctx: DemoContext): Promise<void> => {
  const list = await kibanaRequest<CortexListResponse>(
    ctx.connection,
    'GET',
    '/internal/nightshift/cortex/pages'
  );
  if (list.status >= 300) {
    throw new Error(`Failed to list Cortex pages (HTTP ${list.status})`);
  }
  for (const summary of list.data.pages) {
    const prefix = `cortex_${summary.entity_type}_`;
    if (
      !summary.id.startsWith(prefix) ||
      !summary.id.slice(prefix.length).startsWith(DEMO_SLUG_PREFIX)
    ) {
      continue;
    }
    const current = await kibanaRequest<CortexPageResponse>(
      ctx.connection,
      'GET',
      cortexPagePath(summary.id)
    );
    if (current.status !== 200 || !current.data.page.version) {
      continue;
    }
    await kibanaRequest(
      ctx.connection,
      'DELETE',
      `${cortexPagePath(summary.id)}?version=${encodeURIComponent(current.data.page.version)}`
    );
  }
};

/** Writes a memory page the way the memory page store does: same id scheme and document shape. */
const writeMemoryPage = async (ctx: DemoContext, page: MemoryPageInput): Promise<void> => {
  const nowIso = iso();
  const space = ctx.connection.space;
  await ctx.esClient.index({
    index: MEMORY_INDEX,
    id: `${space}:memory_${page.slug}`,
    refresh: 'wait_for',
    document: {
      '@timestamp': nowIso,
      type: 'memory',
      title: page.title,
      description: page.context,
      content: page.content,
      tags: ['memory', DEMO_TAG, ...page.tags],
      attributes: {
        slug: page.slug,
        space_id: space,
        categories: page.categories,
        references: [],
        created_at: nowIso,
        updated_at: nowIso,
        created_by: 'nightshift-demo',
        updated_by: 'nightshift-demo',
        impressions: 0,
        conversions: 0,
        last_impression_time: nowIso,
      },
    },
  });
};

/**
 * Writes the decision tree head and its first version, the way the decision tree store does.
 * The diagram is parsed first, so a malformed tree fails the seed instead of storing a broken one.
 */
const writeDecisionTree = async (ctx: DemoContext): Promise<void> => {
  const { diagram, symptom, title, summary, description, evidenceGathererMetadata } = DECISION_TREE;
  const markdown = [`# ${title}`, '', description, '', '```mermaid', diagram, '```', ''].join('\n');
  const tree = parseMermaidDecisionTree(extractMermaid(markdown), symptomTreeId(symptom));
  const nowIso = iso();
  const space = ctx.connection.space;
  const attributes = {
    tree_id: symptomTreeId(symptom),
    symptom,
    version: 1,
    status: 'established',
    node_count: tree.nodes.length,
    edge_count: tree.edges.length,
    space_id: space,
  };
  const tags = ['nightshift', DECISION_TREE_TAG, DEMO_TAG];

  await ctx.esClient.index({
    index: DECISION_TREE_AI_INDEX_DEST,
    id: `${space}:dtree_${symptom}`,
    refresh: 'wait_for',
    document: {
      '@timestamp': nowIso,
      type: 'decision_tree',
      title,
      content: markdown,
      tags,
      attributes,
      learnings: [],
      evidence_gatherer_metadata: evidenceGathererMetadata,
    },
  });
  await ctx.esClient.index({
    index: DECISION_TREE_AI_INDEX_DEST,
    id: `${space}:dtree_${symptom}_v1`,
    refresh: 'wait_for',
    document: {
      '@timestamp': nowIso,
      type: 'decision_tree_version',
      title: `${title} v1`,
      content: markdown,
      tags,
      attributes: { ...attributes, author: 'nightshift-demo', summary, reinforced: true },
      learnings: [],
      evidence_gatherer_metadata: evidenceGathererMetadata,
    },
  });
};
