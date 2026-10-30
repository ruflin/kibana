/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Client } from '@elastic/elasticsearch';
import type { ToolingLog } from '@kbn/tooling-log';
import { LogLevel, SynthtraceClientsManager, createLogger, sigEvents } from '@kbn/synthtrace';
import type { LogsManifest } from '@kbn/synthtrace/src/lib/service_graph_logs/types';
import { DEP_TO_CATEGORY } from '@kbn/synthtrace/src/lib/service_graph_logs/constants';
import { CLAIMS_APP } from '@kbn/synthtrace/src/scenarios/sigevents/mock_apps/claims';
import { incidentAt, makePhaseContext } from '@kbn/synthtrace/src/scenarios/sigevents/utils';
import { log as synthLog, timerange } from '@kbn/synthtrace-client';
import { SIGNIFICANT_EVENTS_ALERT_SOURCE } from '@kbn/significant-events-schema';
import type { FeatureUpsert } from '@kbn/significant-events-schema';
import { v5 as uuidv5 } from 'uuid';
import { METRIC_SERIES_MAX_WRITE_DELAY } from '@kbn/significant-events-plugin/server/lib/significant_events/rules/metric_series_contract';
import { getDurationMinutes } from '@kbn/significant-events-plugin/server/lib/significant_events/rules/schedule';
import { computeRuleId } from '@kbn/significant-events-plugin/server/lib/knowledge_indicators/helpers/compute_rule_id';
import type { DemoConnection } from './http';
import { bulkCreate, kibanaRequest, esRequest } from './http';
import {
  DEMO_ID_NAMESPACE,
  DEMO_EVENT_ID_PREFIX,
  DEMO_QUERIES,
  DEMO_SCENARIO,
  DEMO_SOURCE_TITLE,
  DEMO_TAG,
  RED_HERRING_QUERY_INDEX,
  type DemoEvent,
} from './dataset';

const TICK_MS = 60_000;
const BASELINE_MINUTES = 30;
const RELIABLE_HORIZON_PADDING_MINUTES = 1;
export const DETECTIONS_INDEX = '.significant_events-detections';
export const EVENTS_DATA_STREAM = '.rule-events';

/** Seeded sources, queries and features, shared by the later steps. */
export interface DemoContext {
  connection: DemoConnection;
  log: ToolingLog;
  esClient: Client;
  /** Fixed seed, so the synthetic logs are the same on every run. */
  seed: number;
  /** Start of the seeded log window, in epoch ms. */
  generatedAtMs: number;
}

export interface DemoSource {
  id: string;
  viewName: string;
  streamName: string;
}

export interface DemoRule {
  queryId: string;
  ruleId: string;
  title: string;
  severityScore: number;
}

export interface DemoFeatures {
  /** Feature id of a claims service, by service name. */
  featureIdFor: (serviceName: string) => string;
}

const deterministicId = (...parts: string[]): string => uuidv5(parts.join(':'), DEMO_ID_NAMESPACE);

const iso = (epochMs: number): string => new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z');

const toClosedMinuteEpochMs = (epochMs: number): number => {
  const date = new Date(epochMs);
  date.setUTCSeconds(0, 0);
  return date.getTime();
};

/** Writes the claims pipeline logs, with the fraud-check incident in the last few minutes. */
export const seedLogs = async (
  ctx: DemoContext
): Promise<{ manifest: LogsManifest; streamName: string }> => {
  const scenario = CLAIMS_APP.scenarios[DEMO_SCENARIO];
  const cycleDurationMinutes = scenario.cycleDurationMinutes ?? 10;
  const writeDelayMinutes = getDurationMinutes(METRIC_SERIES_MAX_WRITE_DELAY);
  const to =
    toClosedMinuteEpochMs(ctx.generatedAtMs) -
    (writeDelayMinutes + RELIABLE_HORIZON_PADDING_MINUTES) * TICK_MS;
  const totalBuckets = BASELINE_MINUTES + cycleDurationMinutes;
  const from = to - (totalBuckets - 1) * TICK_MS;
  const failureStartMs = from + BASELINE_MINUTES * TICK_MS;

  const { failures, volume, noise, ghostMentions } = scenario.build(
    makePhaseContext(incidentAt(from, BASELINE_MINUTES * TICK_MS))
  );
  const { generator, manifest } = sigEvents.buildLogsGenerator({
    seed: ctx.seed,
    serviceGraph: CLAIMS_APP.serviceGraph,
    entryService: CLAIMS_APP.entryService,
    tickIntervalMs: TICK_MS,
    cycleMs: cycleDurationMinutes * TICK_MS,
    cycleOriginMs: failureStartMs,
    failures,
    volume,
    noise:
      noise || ghostMentions
        ? { ...(noise ?? {}), ...(ghostMentions ? { ghostMentions } : {}) }
        : undefined,
  });

  const manager = new SynthtraceClientsManager({
    client: ctx.esClient,
    logger: createLogger(LogLevel.info),
    refreshAfterIndex: false,
  });
  const { logsEsClient } = manager.getClients({ clients: ['logsEsClient'] });
  await logsEsClient.index(
    timerange(new Date(from), new Date(to)).interval('1m').generator(generator)
  );

  const { fields } = synthLog.createMinimal();
  const streamName = `${fields['data_stream.type']}-${fields['data_stream.dataset']}-${fields['data_stream.namespace']}`;
  await ctx.esClient.indices.refresh({ index: `${streamName}*` });
  ctx.log.info(
    `Seeded claims logs into "${streamName}" (${new Date(from).toISOString()} → ${new Date(
      to
    ).toISOString()})`
  );
  return { manifest, streamName };
};

/** Lists the sources in the demo space. The search parameter does not match titles with parentheses, so titles are filtered here. */
const listDemoSources = async (
  ctx: DemoContext
): Promise<Array<{ id: string; title: string; view_name: string }>> => {
  const response = await kibanaRequest<{
    sources: Array<{ id: string; title: string; view_name: string }>;
  }>(ctx.connection, 'GET', '/internal/nightshift/sources?per_page=100');
  if (response.status >= 300) {
    throw new Error(`Failed to list sources (HTTP ${response.status})`);
  }
  return response.data.sources;
};

/** Resumes Significant Events if a previous run paused it, because writes are blocked while paused. */
export const resumeIfPaused = async (ctx: DemoContext): Promise<void> => {
  const status = await kibanaRequest<{ state: string }>(
    ctx.connection,
    'GET',
    '/internal/significant_events/maintenance/_status'
  );
  if (status.data.state !== 'paused') {
    return;
  }
  const response = await kibanaRequest(
    ctx.connection,
    'POST',
    '/internal/significant_events/maintenance/_resume',
    {}
  );
  if (response.status >= 300) {
    throw new Error(`Failed to resume Significant Events (HTTP ${response.status})`);
  }
  ctx.log.info('Resumed Significant Events for the seed');
};

/** Creates the demo source over the claims logs, or reuses it if it already exists. */
export const ensureSource = async (ctx: DemoContext, streamName: string): Promise<DemoSource> => {
  const existing = (await listDemoSources(ctx)).find(({ title }) => title === DEMO_SOURCE_TITLE);
  if (existing) {
    ctx.log.info(`Reusing demo source ${existing.id}`);
    return { id: existing.id, viewName: existing.view_name, streamName };
  }

  const created = await kibanaRequest<{ source: { id: string; view_name: string } }>(
    ctx.connection,
    'POST',
    '/internal/nightshift/sources',
    {
      title: DEMO_SOURCE_TITLE,
      description: 'Claims pipeline logs for the Nightshift demo',
      tags: [DEMO_TAG],
      esql: `FROM ${streamName}`,
    }
  );
  if (created.status >= 300) {
    throw new Error(`Failed to create the demo source (HTTP ${created.status})`);
  }
  ctx.log.info(`Created demo source ${created.data.source.id}`);
  return { id: created.data.source.id, viewName: created.data.source.view_name, streamName };
};

/** Creates one knowledge indicator per claims service and per dependency edge. */
export const seedKnowledgeIndicators = async (
  ctx: DemoContext,
  source: DemoSource,
  manifest: LogsManifest
): Promise<DemoFeatures> => {
  const features: FeatureUpsert[] = [];
  const serviceFeatureIds = new Map<string, string>();

  for (const service of manifest.services) {
    const runtime = 'runtime' in service ? String(service.runtime) : 'unknown';
    const id = deterministicId(source.id, 'feature', 'entity', service.name);
    serviceFeatureIds.set(service.name, id);
    features.push({
      id,
      type: 'entity',
      subtype: 'service',
      title: service.name,
      description: `Application service ${service.name} (${runtime}) in the claims pipeline.`,
      properties: { name: service.name, runtime },
      confidence: 100,
      tags: ['entity', 'service'],
      evidence: [`service.name=${service.name}`],
      evidence_doc_ids: [],
      filter: { field: 'service.name', eq: service.name },
    });
  }

  for (const dependency of manifest.activeInfraDeps) {
    const subtype = DEP_TO_CATEGORY[dependency] ?? 'database';
    features.push({
      id: deterministicId(source.id, 'feature', 'infra-entity', dependency),
      type: 'entity',
      subtype,
      title: dependency,
      description: `${subtype.replace(
        '_',
        ' '
      )} component ${dependency} used by the claims pipeline.`,
      properties: { name: dependency, technology: dependency },
      confidence: 100,
      tags: ['entity', subtype],
      evidence: [`"${dependency}"`],
      evidence_doc_ids: [],
    });
  }

  for (const edge of manifest.edges) {
    const protocol = String(edge.protocol);
    features.push({
      id: deterministicId(source.id, 'feature', 'dependency', `${edge.source}->${edge.target}`),
      type: 'dependency',
      subtype: 'service_dependency',
      title: `${edge.source} → ${edge.target}`,
      description: `${protocol.toUpperCase()} call from ${edge.source} to ${edge.target}.`,
      properties: { source: edge.source, target: edge.target, protocol },
      confidence: 100,
      tags: ['dependency', protocol],
      evidence: [`service.name=${edge.source}`, `peer.service=${edge.target}`],
      evidence_doc_ids: [],
    });
  }

  const response = await kibanaRequest(
    ctx.connection,
    'POST',
    `/internal/streams/${encodeURIComponent(source.id)}/features/_bulk`,
    { operations: features.map((feature) => ({ index: { feature } })) }
  );
  if (response.status >= 300) {
    throw new Error(`Failed to write knowledge indicators (HTTP ${response.status})`);
  }
  ctx.log.info(`Wrote ${features.length} knowledge indicators`);

  return {
    featureIdFor: (serviceName: string) => {
      const id = serviceFeatureIds.get(serviceName);
      if (!id) {
        throw new Error(`No knowledge indicator for service "${serviceName}"`);
      }
      return id;
    },
  };
};

/** Upserts the demo queries and promotes them, which creates the alerting rules behind them. */
export const seedRules = async (ctx: DemoContext, source: DemoSource): Promise<DemoRule[]> => {
  const prepared = DEMO_QUERIES.map((query) => {
    const esql = query.esql(source.viewName);
    return {
      query,
      esql,
      queryId: deterministicId(source.id, query.title, 'query'),
    };
  });

  for (const { query, esql, queryId } of prepared) {
    const response = await kibanaRequest(
      ctx.connection,
      'PUT',
      `/internal/significant_events/queries/${encodeURIComponent(queryId)}`,
      {
        title: query.title,
        esql: { query: esql },
        severity_score: query.severityScore,
        description: query.description,
        source_id: source.id,
      }
    );
    if (response.status >= 300) {
      throw new Error(`Failed to upsert query "${query.title}" (HTTP ${response.status})`);
    }
  }

  const promote = await kibanaRequest<{ skipped_stats: number; skipped_ineligible: number }>(
    ctx.connection,
    'POST',
    '/internal/streams/queries/_promote',
    { queryIds: prepared.map(({ queryId }) => queryId) }
  );
  if (promote.status >= 300) {
    throw new Error(`Query promotion failed (HTTP ${promote.status})`);
  }
  if (promote.data.skipped_stats > 0 || promote.data.skipped_ineligible > 0) {
    throw new Error(
      `Query promotion skipped ${promote.data.skipped_stats} STATS and ${promote.data.skipped_ineligible} ineligible queries`
    );
  }
  ctx.log.info(`Promoted ${prepared.length} queries`);

  return prepared.map(({ query, esql, queryId }) => ({
    queryId,
    ruleId: computeRuleId(ctx.connection.space, source.id, queryId, esql),
    title: query.title,
    severityScore: query.severityScore,
  }));
};

/** Detection document for one event: the change point that the rule found for it. */
export const buildDetection = (
  source: DemoSource,
  rules: DemoRule[],
  event: DemoEvent,
  eventId: string,
  space: string,
  raisedAtMs: number
): Record<string, unknown> => {
  const rule = rules[event.queryIndex];
  return {
    '@timestamp': iso(raisedAtMs - 60_000),
    detection_id: deterministicId(source.id, 'detection', eventId),
    rule_uuid: rule.ruleId,
    rule_name: rule.title,
    change_point_type: 'spike',
    p_value: 0.0001,
    severity_score: rule.severityScore,
    processed_by: DEMO_TAG,
    source_id: source.id,
    kibana: { space_ids: [space] },
    ...(event.queryIndex === RED_HERRING_QUERY_INDEX ? { skip: { event_id: eventId } } : {}),
  };
};

/** Alerting v2 rule event for one significant event, shaped like `toRuleEvent` writes it. */
export const buildEventDocument = (
  source: DemoSource,
  rules: DemoRule[],
  features: DemoFeatures,
  event: DemoEvent,
  eventId: string,
  space: string,
  raisedAtMs: number
): Record<string, unknown> => {
  const rule = rules[event.queryIndex];
  const timestamp = iso(raisedAtMs);
  const data = {
    event_id: eventId,
    rule_name: event.title,
    title: event.title,
    summary: event.summary,
    confidence: event.confidence,
    source_ids: [source.id],
    symptom_hypothesis: event.symptomHypothesis,
    assessment_note: event.assessmentNote,
    signals: [{ metadata: { rule_uuid: rule.ruleId }, rule_name: rule.title }],
    causal_features: event.causalServices.map((service) => ({
      feature_id: features.featureIdFor(service),
    })),
    blast_radius: event.blastServices.map((service) => ({
      feature_id: features.featureIdFor(service),
    })),
  };
  return {
    '@timestamp': timestamp,
    scheduled_timestamp: timestamp,
    type: 'alert',
    source: SIGNIFICANT_EVENTS_ALERT_SOURCE,
    fingerprint: eventId,
    group_hash: eventId,
    status: 'breached',
    severity: event.severity,
    alert_status: event.status,
    rule: { id: rule.ruleId, version: 1 },
    alert: { id: eventId, status: event.status, status_count: 1 },
    space_id: space,
    data,
  };
};

/** Removes the demo events and detections, so re-running the seed does not duplicate them. */
const deleteDemoEventsAndDetections = async (ctx: DemoContext): Promise<void> => {
  await esRequest(
    ctx.connection,
    'POST',
    `/${EVENTS_DATA_STREAM}/_delete_by_query?refresh=true&conflicts=proceed`,
    { query: { prefix: { 'data.event_id': DEMO_EVENT_ID_PREFIX } } }
  );
  await esRequest(
    ctx.connection,
    'POST',
    `/${DETECTIONS_INDEX}/_delete_by_query?refresh=true&conflicts=proceed`,
    { query: { term: { processed_by: DEMO_TAG } } }
  );
};

/** Writes the detections and events present when the demo starts. */
export const seedDetectionsAndEvents = async (
  ctx: DemoContext,
  source: DemoSource,
  rules: DemoRule[],
  features: DemoFeatures,
  events: DemoEvent[]
): Promise<void> => {
  const space = ctx.connection.space;
  const now = Date.now();
  await deleteDemoEventsAndDetections(ctx);
  const detections: Array<Record<string, unknown>> = [];
  const documents: Array<Record<string, unknown>> = [];

  events.forEach((event) => {
    const eventId = `${DEMO_EVENT_ID_PREFIX}${deterministicId(
      source.id,
      'event',
      event.title
    ).slice(0, 12)}`;
    const raisedAtMs = now - event.raisedMinutesAgo * 60_000;
    detections.push(buildDetection(source, rules, event, eventId, space, raisedAtMs));
    documents.push(buildEventDocument(source, rules, features, event, eventId, space, raisedAtMs));
  });

  await bulkCreate(ctx.connection, DETECTIONS_INDEX, detections);
  await bulkCreate(ctx.connection, EVENTS_DATA_STREAM, documents);
  ctx.log.info(`Wrote ${detections.length} detections and ${documents.length} events`);
};

/** Pauses Significant Events so the real rules and workflows stop acting on the demo data. */
export const pauseSignificantEvents = async (ctx: DemoContext): Promise<void> => {
  const response = await kibanaRequest(
    ctx.connection,
    'POST',
    '/internal/significant_events/maintenance/_pause',
    {}
  );
  if (response.status >= 300) {
    throw new Error(`Failed to pause Significant Events (HTTP ${response.status})`);
  }
  ctx.log.info('Paused Significant Events for the demo space');
};

/** Removes the demo source and the demo detections and events. Logs stay; they are time-bounded. */
export const cleanDemoData = async (ctx: DemoContext): Promise<void> => {
  const sources = (await listDemoSources(ctx)).filter(({ title }) => title === DEMO_SOURCE_TITLE);
  for (const source of sources) {
    const queryIds = DEMO_QUERIES.map((query) => deterministicId(source.id, query.title, 'query'));
    await kibanaRequest(ctx.connection, 'POST', '/internal/streams/queries/_bulk_delete', {
      queryIds,
    });
    await kibanaRequest(ctx.connection, 'DELETE', `/internal/nightshift/sources/${source.id}`);
    ctx.log.info(`Deleted demo source ${source.id} and its queries`);
  }

  await deleteDemoEventsAndDetections(ctx);
  ctx.log.info('Deleted demo events and detections');
};
