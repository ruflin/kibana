/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql, type ComposerQuery, type ComposerSortShorthand } from '@elastic/esql';
import type { ESQLAstExpression } from '@elastic/esql/types';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { AlertEventsClientApi, CreateSignalEventData } from '@kbn/alerting-v2-plugin/server';
import {
  detectionFromSignalSource,
  SIGNIFICANT_EVENTS_DETECTION_PROCESSED_SOURCE,
  SIGNIFICANT_EVENTS_DETECTION_SCANNED_SOURCE,
  SIGNIFICANT_EVENTS_DETECTION_SOURCE,
  type Detection,
  type DetectionSignalSource,
} from '@kbn/significant-events-schema';
import {
  type CommonSearchOptions,
  type PaginatedSearchOptions,
  type PaginatedResponse,
} from '../query_utils';
import {
  andWhere,
  applyTimeRange,
  esqlToObjects,
  executeCountQuery,
  executeEsqlQuery,
  pickLatestPerGroup,
  queryEsql,
  withWhere,
} from '../latest_source_query';
import { RULE_EVENTS_INDEX } from '../alerting/rule_events_metric_series';

/**
 * A detection as the Detection workflow submits it. `change_point_type` is not narrowed to
 * `CHANGE_POINT_TYPES`: Elasticsearch can also report `indeterminable`, which is persisted like
 * any other non-stationary observation.
 */
export interface DetectionInput {
  detection_id: string;
  rule_uuid: string;
  rule_name?: string;
  source_id?: string;
  change_point_type: string;
  p_value: number;
  severity_score?: number;
  alert_index?: string;
  workflow_execution_id?: string;
}

// `processed` is derived at query time from processed markers, never stored.
type RawDetection = Omit<Detection, 'processed'>;

export interface DetectionsSearchOptions extends CommonSearchOptions {
  rule_uuid?: string[];
  rule_name?: string;
}

export interface DetectionsPaginatedSearchOptions extends PaginatedSearchOptions {
  rule_uuid?: string[];
  rule_name?: string;
}

const PROCESSED_MARKER_CHUNK_SIZE = 250;

// Page size and write batch size of the sweep that marks a deleted source's detections processed.
const SOURCE_SWEEP_PAGE_SIZE = 1000;

// Row cap of one history read, the ES|QL maximum.
const ESQL_MAX_ROWS = 10_000;

// Cap the per-rule detection history (flyout timeline) to the most recent N transitions so a churny
// rule doesn't produce an unbounded scroll.
const DETECTION_HISTORY_LIMIT = 20;

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 25;

// `rule.id` is the rule UUID of a detection and of a scan marker; processed markers carry none.
const ruleIdColumn = () => esql.col(['rule', 'id']);

const dataField = (key: string): ESQLAstExpression =>
  esql.exp`FIELD_EXTRACT(${esql.col('data')}, ${esql.str(key)})`;

/** The detection pipeline's signals of one kind in one space of `.rule-events`. */
const fromSignals = (space: string, source: string): ComposerQuery =>
  esql.from([RULE_EVENTS_INDEX], ['_id', '_source']).where`${esql.col('space_id')} == ${esql.str(
    space
  )} AND ${esql.col('type')} == ${esql.str('signal')} AND ${esql.col('source')} == ${esql.str(
    source
  )}`;

const detectionIdIn = (detectionIds: string[]): ESQLAstExpression =>
  esql.exp`${dataField('detection_id')} IN (${detectionIds.map((id) => esql.str(id))})`;

const ruleIdIn = (ruleUuids: string[]): ESQLAstExpression =>
  esql.exp`${ruleIdColumn()} IN (${ruleUuids.map((id) => esql.str(id))})`;

const toDetectionData = ({
  rule_uuid: _ruleUuid,
  ...data
}: DetectionInput): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));

/**
 * Reads and writes change-point detections, stored as Alerting v2 `type: signal` events in
 * `.rule-events`. A detection is appended to the series of the rule it was observed on (`rule.id`),
 * with its payload under `data`. Processed and scan markers are signals with their own sources, so
 * every read selects one kind by `source`.
 */
export class DetectionClient {
  constructor(
    private readonly clients: {
      getAlertEventsClient: () => Promise<Pick<AlertEventsClientApi, 'createSignalEvents'>>;
      esClient: ElasticsearchClient;
      space: string;
    }
  ) {}

  // Detection reads group the latest revision per rule (rule_uuid), not per detection id —
  // detection_id is unique-per-detection, so grouping by it would never collapse.
  private buildWhere(options: DetectionsSearchOptions): ESQLAstExpression | undefined {
    let where: ESQLAstExpression | undefined;
    if (options.rule_uuid?.length) {
      where = ruleIdIn(options.rule_uuid);
    }
    if (options.rule_name) {
      where = andWhere(
        where,
        esql.exp`${dataField('rule_name')} == ${esql.str(options.rule_name)}`
      );
    }
    return where;
  }

  private buildLatestQuery(options: DetectionsSearchOptions): ComposerQuery {
    const query = applyTimeRange({
      query: fromSignals(this.clients.space, SIGNIFICANT_EVENTS_DETECTION_SOURCE),
      from: options.from,
      to: options.to,
    });
    const ofRules = withWhere(query, this.buildWhere(options))
      .pipe`EVAL rule_uuid = ${ruleIdColumn()}`;
    return pickLatestPerGroup(ofRules, 'rule_uuid');
  }

  private async readDetections(query: ComposerQuery): Promise<RawDetection[]> {
    const sources = await executeEsqlQuery<DetectionSignalSource>({
      esClient: this.clients.esClient,
      query: query.keep('_source'),
    });
    return sources.map(detectionFromSignalSource);
  }

  /** Detections matching `where`, oldest first unless `limit` asks for the most recent N. */
  private async findDetections({
    where,
    limit,
    latestFirst = false,
  }: {
    where?: ESQLAstExpression;
    limit?: number;
    latestFirst?: boolean;
  }): Promise<RawDetection[]> {
    let query = withWhere(
      fromSignals(this.clients.space, SIGNIFICANT_EVENTS_DETECTION_SOURCE),
      where
    ).sort(['@timestamp', latestFirst ? 'DESC' : 'ASC']);
    if (limit !== undefined) {
      query = query.limit(limit);
    }
    const hits = await this.readDetections(query);
    return latestFirst ? hits.reverse() : hits;
  }

  // `processed` is derived: a detection is processed iff a marker references its exact id.
  private async getProcessedIds(detectionIds: string[]): Promise<Set<string>> {
    const processed = new Set<string>();
    for (let i = 0; i < detectionIds.length; i += PROCESSED_MARKER_CHUNK_SIZE) {
      const batch = detectionIds.slice(i, i + PROCESSED_MARKER_CHUNK_SIZE);
      const query = fromSignals(this.clients.space, SIGNIFICANT_EVENTS_DETECTION_PROCESSED_SOURCE)
        .pipe`EVAL detection_id = ${dataField('detection_id')}`.where`${detectionIdIn(batch)}`
        .pipe`STATS marker_count = COUNT(*) BY detection_id`.keep('detection_id');
      const rows = esqlToObjects<{ detection_id?: string }>(
        await queryEsql({ esClient: this.clients.esClient, query })
      );
      for (const { detection_id: id } of rows) {
        if (id) processed.add(id);
      }
    }
    return processed;
  }

  private async writeSignals(events: CreateSignalEventData[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const alertEventsClient = await this.clients.getAlertEventsClient();
    await alertEventsClient.createSignalEvents(events);
  }

  /** Appends detections to the series of the rule each one was observed on. */
  async createDetections({
    detections,
    timestamp,
  }: {
    detections: DetectionInput[];
    timestamp: string;
  }): Promise<void> {
    await this.writeSignals(
      detections.map((detection) => ({
        source: SIGNIFICANT_EVENTS_DETECTION_SOURCE,
        rule_id: detection.rule_uuid,
        timestamp,
        data: toDetectionData(detection),
      }))
    );
  }

  /** Records that detections were processed, which sets their derived `processed` flag. */
  async markProcessed({
    detectionIds,
    processedBy,
    timestamp,
  }: {
    detectionIds: string[];
    processedBy: string;
    timestamp: string;
  }): Promise<void> {
    await this.writeSignals(
      detectionIds.map((detectionId) => ({
        source: SIGNIFICANT_EVENTS_DETECTION_PROCESSED_SOURCE,
        fingerprint: detectionId,
        timestamp,
        data: { detection_id: detectionId, processed_by: processedBy },
      }))
    );
  }

  /** Records that rules were scanned without a new detection, for scan scheduling. */
  async markScanned({
    ruleUuids,
    scannedBy,
    timestamp,
  }: {
    ruleUuids: string[];
    scannedBy: string;
    timestamp: string;
  }): Promise<void> {
    await this.writeSignals(
      ruleUuids.map((ruleUuid) => ({
        source: SIGNIFICANT_EVENTS_DETECTION_SCANNED_SOURCE,
        rule_id: ruleUuid,
        timestamp,
        data: { scanned_by: scannedBy },
      }))
    );
  }

  async findById(detectionId: string): Promise<{ hits: Detection[] }> {
    return this.findByIds([detectionId]);
  }

  async findByIds(detectionIds: string[]): Promise<{ hits: Detection[] }> {
    if (detectionIds.length === 0) {
      return { hits: [] };
    }
    const hits = await this.findDetections({ where: detectionIdIn(detectionIds) });
    return { hits: await this.withDerivedProcessed(hits) };
  }

  // A rule's change-point timeline: every detection for the rule, oldest→newest. Keyed on
  // rule_uuid (not detection_id) because detection_id is unique per detection — the list
  // collapses to the latest per rule, and the flyout expands the full history here.
  async findHistoryByRuleUuid(ruleUuid: string): Promise<{ hits: Detection[] }> {
    const hits = await this.findDetections({
      where: ruleIdIn([ruleUuid]),
      // Most recent N transitions, returned chronologically (oldest→newest of that window).
      limit: DETECTION_HISTORY_LIMIT,
      latestFirst: true,
    });
    return { hits: await this.withDerivedProcessed(hits) };
  }

  async findLatest(options: DetectionsSearchOptions = {}): Promise<{ hits: Detection[] }> {
    const hits = await this.readDetections(this.buildLatestQuery(options));
    return { hits: await this.withDerivedProcessed(hits) };
  }

  async findLatestPaginated(
    options: DetectionsPaginatedSearchOptions = {}
  ): Promise<PaginatedResponse<Detection>> {
    const page = options.page ?? DEFAULT_PAGE;
    const perPage = options.perPage ?? DEFAULT_PER_PAGE;
    const sort: ComposerSortShorthand = ['@timestamp', 'DESC'];

    const [total, hits] = await Promise.all([
      executeCountQuery({
        esClient: this.clients.esClient,
        query: this.buildLatestQuery(options).pipe`STATS total = COUNT(*)`.keep('total'),
      }),
      this.readDetections(
        this.buildLatestQuery(options)
          .sort(sort)
          .limit(page * perPage)
      ),
    ]);

    const start = (page - 1) * perPage;
    const pageHits = start >= hits.length ? [] : hits.slice(start, start + perPage);
    return { hits: await this.withDerivedProcessed(pageHits), page, perPage, total };
  }

  /**
   * Marks every unprocessed detection of a source as processed, and returns how many it marked.
   * A deleted source leaves its detections behind, and the discovery batch keeps offering them, so
   * the agent writes events for a source that no longer exists. A rule can hold several
   * unprocessed detections, and discovery falls back to the next one when the newest is processed,
   * so the whole history of each rule is marked, not only its latest detection.
   *
   * The latest detection of every rule is read to find the source's rules, then their histories.
   */
  async markSourceDetectionsProcessed({
    sourceId,
    processedBy,
    historyPageSize = ESQL_MAX_ROWS,
  }: {
    sourceId: string;
    processedBy: string;
    /** Rows of a rule's history read per query. Defaults to the ES|QL maximum. */
    historyPageSize?: number;
  }): Promise<number> {
    const ruleUuids = new Set<string>();
    for (let page = 1; ; page++) {
      const result = await this.findLatestPaginated({ page, perPage: SOURCE_SWEEP_PAGE_SIZE });
      for (const detection of result.hits) {
        if (detection.source_id === sourceId && detection.rule_uuid) {
          ruleUuids.add(detection.rule_uuid);
        }
      }
      if (page * SOURCE_SWEEP_PAGE_SIZE >= result.total) {
        break;
      }
    }

    const detectionIdSet = new Set<string>();
    for (const ruleUuid of ruleUuids) {
      await this.collectUnprocessedHistory({
        ruleUuid,
        sourceId,
        pageSize: historyPageSize,
        into: detectionIdSet,
      });
    }
    const detectionIds = [...detectionIdSet];

    const timestamp = new Date().toISOString();
    for (let start = 0; start < detectionIds.length; start += SOURCE_SWEEP_PAGE_SIZE) {
      await this.markProcessed({
        detectionIds: detectionIds.slice(start, start + SOURCE_SWEEP_PAGE_SIZE),
        processedBy,
        timestamp,
      });
    }
    return detectionIds.length;
  }

  /**
   * Adds the ids of a rule's unprocessed detections of the source to `into`, reading its history
   * oldest to newest in pages. A page starts at the last timestamp seen, so rows sharing it appear
   * twice and the set dedupes them. It stops on a short page, or on one that brings no new row,
   * which also ends a page made only of rows with one timestamp.
   */
  private async collectUnprocessedHistory({
    ruleUuid,
    sourceId,
    pageSize,
    into,
  }: {
    ruleUuid: string;
    sourceId: string;
    pageSize: number;
    into: Set<string>;
  }): Promise<void> {
    const seen = new Set<string>();
    let after: string | undefined;
    for (;;) {
      const hits = await this.findDetections({
        where:
          after === undefined
            ? ruleIdIn([ruleUuid])
            : andWhere(
                ruleIdIn([ruleUuid]),
                esql.exp`${esql.col('@timestamp')} >= TO_DATETIME(${esql.str(after)})`
              ),
        limit: pageSize,
      });

      const unseen = hits.filter(({ detection_id: id }) => id !== undefined && !seen.has(id));
      unseen.forEach(({ detection_id: id }) => seen.add(id as string));
      for (const detection of await this.withDerivedProcessed(unseen)) {
        if (detection.source_id === sourceId && !detection.processed && detection.detection_id) {
          into.add(detection.detection_id);
        }
      }

      const last = hits.at(-1);
      if (hits.length < pageSize || unseen.length === 0 || last === undefined) {
        return;
      }
      after = last['@timestamp'];
    }
  }

  private async withDerivedProcessed(rawHits: RawDetection[]): Promise<Detection[]> {
    const processedIds = await this.getProcessedIds(
      rawHits.map((h) => h.detection_id).filter((id): id is string => Boolean(id))
    );
    return rawHits.map(
      (raw) => ({ ...raw, processed: processedIds.has(raw.detection_id ?? '') } as Detection)
    );
  }
}
