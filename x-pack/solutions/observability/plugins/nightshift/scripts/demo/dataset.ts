/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Synthtrace scenario in the claims mock app that drives the demo logs. */
export const DEMO_SCENARIO = 'fraud_check_redis_herring';

/** Title of the Nightshift source the demo creates over the claims logs. */
export const DEMO_SOURCE_TITLE = 'Claims pipeline (demo)';

/** Tag on every source, detection and event the demo writes, so `--clean` removes only demo data. */
export const DEMO_TAG = 'nightshift-demo';

/** Prefix on demo event ids; `--clean` deletes events by this prefix. */
export const DEMO_EVENT_ID_PREFIX = 'demo-';

/** Namespace for deterministic demo ids (uuid v5). */
export const DEMO_ID_NAMESPACE = '0c7f2a4e-6b1d-4f0a-9e3b-5d2c8a7f1e61';

export interface DemoQuery {
  title: string;
  description: string;
  severityScore: number;
  /** Receives the source view name; the queries endpoint requires `FROM` to be that view. */
  esql: (viewName: string) => string;
}

/** Two queries: the real incident and the Redis/Kafka red herring the scenario plants. */
export const DEMO_QUERIES: DemoQuery[] = [
  {
    title: 'Primary fraud gateway timeouts',
    description: 'fraud-check deadline and upstream timeout errors that stall claim intake.',
    severityScore: 90,
    esql: (viewName) =>
      `FROM ${viewName}
| WHERE \`service.name\` == "fraud-check" AND (message LIKE "*deadline*" OR message LIKE "*Upstream timeout*" OR message LIKE "*timeout*")`,
  },
  {
    title: 'Redis / Kafka red-herring mentions',
    description: 'Redis and Kafka lines that look related but do not explain the claim delays.',
    severityScore: 4,
    esql: (viewName) =>
      `FROM ${viewName}
| WHERE message LIKE "*Redis*" OR message LIKE "*Kafka*" OR message LIKE "*consumer lag*"`,
  },
];

/** Index into DEMO_QUERIES of the query that raises the real incident. */
export const PRIMARY_QUERY_INDEX = 0;
/** Index into DEMO_QUERIES of the red-herring query. */
export const RED_HERRING_QUERY_INDEX = 1;

export type DemoEventSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type DemoEventStatus = 'active' | 'recovering' | 'inactive';

export interface DemoEvent {
  title: string;
  summary: string;
  symptomHypothesis: string;
  assessmentNote: string;
  severity: DemoEventSeverity;
  status: DemoEventStatus;
  confidence: number;
  /** Index into DEMO_QUERIES whose rule raised the event. */
  queryIndex: number;
  /** Service names (claims app) whose KIs are the likely cause and the impacted ones. */
  causalServices: string[];
  blastServices: string[];
  /** Minutes before now when the event was raised. */
  raisedMinutesAgo: number;
}

/** Events present when the demo starts. */
export const DEMO_EVENTS: DemoEvent[] = [
  {
    title: 'Fraud gateway timeouts stalling claim intake',
    summary:
      'fraud-check is timing out on about 70% of requests, so claim-intake cannot finish claims and payment-processor receives fewer of them.',
    symptomHypothesis: 'Upstream fraud gateway is overloaded and missing its deadline.',
    assessmentNote:
      'Redis and Kafka messages in the same window are not linked to the failures: fraud-check fails before it calls either.',
    severity: 'critical',
    status: 'active',
    confidence: 92,
    queryIndex: PRIMARY_QUERY_INDEX,
    causalServices: ['fraud-check'],
    blastServices: ['claim-intake', 'payment-processor'],
    raisedMinutesAgo: 14,
  },
  {
    title: 'Redis timeouts in logs, not linked to claim delays',
    summary:
      'Redis connection timeouts and Kafka consumer lag appear in the logs, but claim processing errors happen only on fraud-check.',
    symptomHypothesis: 'Background noise from Redis and Kafka, not the cause of the incident.',
    assessmentNote: 'Dismissed after checking the fraud-check spans.',
    severity: 'low',
    status: 'inactive',
    confidence: 40,
    queryIndex: RED_HERRING_QUERY_INDEX,
    causalServices: [],
    blastServices: [],
    raisedMinutesAgo: 22,
  },
];

/** Events the live mode raises one by one, every few minutes, to show the feed moving. */
export const DEMO_LIVE_EVENTS: DemoEvent[] = [
  {
    title: 'Payment retries rising after fraud-check timeouts',
    summary: 'payment-processor retries have doubled since fraud-check started timing out.',
    symptomHypothesis: 'Retry storm from payment-processor against a stalled fraud gateway.',
    assessmentNote: 'Retries stop when fraud-check recovers.',
    severity: 'high',
    status: 'active',
    confidence: 85,
    queryIndex: PRIMARY_QUERY_INDEX,
    causalServices: ['fraud-check'],
    blastServices: ['payment-processor'],
    raisedMinutesAgo: 0,
  },
  {
    title: 'Notification backlog growing behind payment-processor',
    summary: 'notification-dispatch is queueing claim updates that payment-processor sends late.',
    symptomHypothesis: 'Delayed input from payment-processor.',
    assessmentNote: 'Expected to clear once the fraud gateway recovers.',
    severity: 'medium',
    status: 'active',
    confidence: 70,
    queryIndex: PRIMARY_QUERY_INDEX,
    causalServices: ['payment-processor'],
    blastServices: ['notification-dispatch'],
    raisedMinutesAgo: 0,
  },
  {
    title: 'Fraud gateway timeouts recovering',
    summary: 'fraud-check error rate is back under 5% and claim intake is completing again.',
    symptomHypothesis: 'The fraud gateway has recovered after its overload cleared.',
    assessmentNote: 'Watching for a repeat over the next hour.',
    severity: 'medium',
    status: 'recovering',
    confidence: 90,
    queryIndex: PRIMARY_QUERY_INDEX,
    causalServices: [],
    blastServices: ['claim-intake'],
    raisedMinutesAgo: 0,
  },
];
