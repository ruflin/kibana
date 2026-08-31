/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  AlertingV2EpisodeSignal,
  AlertingV2EpisodeStatus,
  AlertingV2EventSeverity,
  BlastRadiusEntry,
  SignificantEvent,
  SignificantEventResponse,
  SignalEntry,
} from '@kbn/significant-events-schema';
import { STREAMS_RULE_STREAM_TAG_PREFIX } from '../../knowledge_indicators/knowledge_indicator_client/rules/rules_management_client';
import {
  shouldIngestAlertingV2Episode,
  type AlertingV2EpisodeIngestSkipReason,
  type AlertingV2RuleKind,
} from './should_ingest_alerting_v2_episode';

/** Default temporal window for deterministic Direction B joins (plan Stage 1). */
export const ALERTING_V2_EPISODE_JOIN_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface AlertingV2EpisodeJoinCandidate {
  spaceId: string;
  source: string;
  kind?: AlertingV2RuleKind;
  episodeId: string;
  groupHash: string;
  ruleId?: string | null;
  ruleName?: string;
  ruleTags?: string[];
  episodeStatus: AlertingV2EpisodeStatus;
  severity?: AlertingV2EventSeverity;
  firstTimestamp?: string;
  lastTimestamp?: string;
  streamNames?: string[];
  serviceNames?: string[];
  data?: Record<string, string | number | boolean | undefined>;
}

export type AlertingV2EpisodeJoinSkipReason =
  | AlertingV2EpisodeIngestSkipReason
  | 'space_mismatch'
  | 'missing_episode_id'
  | 'no_open_event'
  | 'ambiguous_open_events'
  | 'no_temporal_overlap'
  | 'no_identity_hit';

export type AlertingV2EpisodeJoinResult =
  | { action: 'join'; eventId: string; signal: AlertingV2EpisodeSignal }
  | { action: 'skip'; reason: AlertingV2EpisodeJoinSkipReason };

const normalizeName = (value: string): string => value.trim().toLowerCase();

const streamNamesFromTags = (tags: string[] | undefined): string[] =>
  (tags ?? [])
    .filter((tag) => tag.startsWith(STREAMS_RULE_STREAM_TAG_PREFIX))
    .map((tag) => tag.slice(STREAMS_RULE_STREAM_TAG_PREFIX.length))
    .filter((name) => name.length > 0);

const stringDataValue = (
  data: Record<string, string | number | boolean | undefined> | undefined,
  key: string
): string | undefined => {
  const value = data?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

const candidateStreamNames = (candidate: AlertingV2EpisodeJoinCandidate): string[] => {
  const streamFromData = stringDataValue(candidate.data, 'stream_name');
  return [
    ...new Set([
      ...(candidate.streamNames ?? []),
      ...streamNamesFromTags(candidate.ruleTags),
      ...(streamFromData ? [streamFromData] : []),
    ]),
  ];
};

const candidateServiceNames = (candidate: AlertingV2EpisodeJoinCandidate): string[] => {
  const fromData = [
    stringDataValue(candidate.data, 'service.name'),
    stringDataValue(candidate.data, 'service'),
    stringDataValue(candidate.data, 'host.name'),
  ].filter((name): name is string => name !== undefined);

  return [...new Set([...(candidate.serviceNames ?? []), ...fromData])].map(normalizeName);
};

const blastRadiusNames = (entry: BlastRadiusEntry): string[] => {
  if (entry.type === 'entity') {
    return [entry.name];
  }
  if (entry.type === 'dependency') {
    return [entry.source, entry.target];
  }
  return [...(entry.title ? [entry.title] : []), ...(entry.workloads ?? [])];
};

const eventTopologyNames = (event: SignificantEvent): Set<string> => {
  const names = new Set<string>();
  for (const feature of event.causal_features ?? []) {
    names.add(normalizeName(feature.name));
  }
  for (const entry of event.blast_radius ?? []) {
    for (const name of blastRadiusNames(entry)) {
      names.add(normalizeName(name));
    }
  }
  return names;
};

const eventRuleIds = (event: SignificantEvent): Set<string> => {
  const ids = new Set<string>();
  for (const signal of event.signals ?? []) {
    if (signal.type === 'detection' && signal.metadata.rule_uuid) {
      ids.add(signal.metadata.rule_uuid);
    }
    if (signal.type === 'alerting_v2_episode' && signal.metadata.rule_id) {
      ids.add(signal.metadata.rule_id);
    }
  }
  return ids;
};

const parseTime = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
};

const eventStartTime = (event: SignificantEvent | SignificantEventResponse): string => {
  if ('created_at' in event && event.created_at) {
    return event.created_at;
  }
  return event['@timestamp'];
};

const hasTemporalOverlap = (
  event: SignificantEvent | SignificantEventResponse,
  candidate: AlertingV2EpisodeJoinCandidate,
  nowMs: number
): boolean => {
  const eventStart = parseTime(eventStartTime(event)) ?? nowMs;
  const episodeStart =
    parseTime(candidate.firstTimestamp) ?? parseTime(candidate.lastTimestamp) ?? nowMs;
  const episodeEnd =
    parseTime(candidate.lastTimestamp) ?? parseTime(candidate.firstTimestamp) ?? nowMs;
  const windowStart = nowMs - ALERTING_V2_EPISODE_JOIN_WINDOW_MS;

  if (episodeEnd < windowStart) {
    return false;
  }

  return episodeEnd >= eventStart && episodeStart <= nowMs;
};

const hasIdentityHit = (
  event: SignificantEvent,
  candidate: AlertingV2EpisodeJoinCandidate
): boolean => {
  const ruleId = candidate.ruleId ?? undefined;
  if (ruleId && eventRuleIds(event).has(ruleId)) {
    return true;
  }

  const eventStreams = new Set(event.stream_names ?? []);
  if (candidateStreamNames(candidate).some((streamName) => eventStreams.has(streamName))) {
    return true;
  }

  const topology = eventTopologyNames(event);
  return candidateServiceNames(candidate).some((name) => topology.has(name));
};

/** Builds a Direction B `alerting_v2_episode` signal from a join candidate. */
export const buildAlertingV2EpisodeSignal = (
  candidate: AlertingV2EpisodeJoinCandidate
): AlertingV2EpisodeSignal => {
  const streamName = candidateStreamNames(candidate)[0] ?? '';
  const description =
    candidate.ruleName !== undefined && candidate.ruleName.length > 0
      ? `Alerting v2 episode for ${candidate.ruleName}.`
      : 'Alerting v2 alert episode joined an open significant event.';

  const signal: AlertingV2EpisodeSignal = {
    type: 'alerting_v2_episode',
    stream_name: streamName,
    description,
    verdict: candidate.episodeStatus === 'inactive' ? 'refutes' : 'confirms',
    collected_at: candidate.lastTimestamp ?? candidate.firstTimestamp,
    metadata: {
      episode_id: candidate.episodeId,
      group_hash: candidate.groupHash,
      source: candidate.source,
      episode_status: candidate.episodeStatus,
      ...(candidate.ruleId ? { rule_id: candidate.ruleId } : {}),
      ...(candidate.ruleName ? { rule_name: candidate.ruleName } : {}),
      ...(candidate.severity ? { severity: candidate.severity } : {}),
    },
  };

  return signal;
};

/**
 * Stage-1 Direction B matcher: join onto exactly one open Significant Event in
 * the same space when time and identity overlap. Never mints a new event.
 */
export const resolveAlertingV2EpisodeJoin = ({
  candidate,
  openEvents,
  spaceId,
  now = new Date(),
}: {
  candidate: AlertingV2EpisodeJoinCandidate;
  openEvents: Array<SignificantEvent | SignificantEventResponse>;
  spaceId: string;
  now?: Date;
}): AlertingV2EpisodeJoinResult => {
  const ingest = shouldIngestAlertingV2Episode(candidate);
  if (!ingest.ingest) {
    return { action: 'skip', reason: ingest.reason };
  }

  if (candidate.spaceId !== spaceId) {
    return { action: 'skip', reason: 'space_mismatch' };
  }

  if (candidate.episodeId.trim().length === 0) {
    return { action: 'skip', reason: 'missing_episode_id' };
  }

  const nowMs = now.getTime();
  const overlapping = openEvents.filter((event) => hasTemporalOverlap(event, candidate, nowMs));
  const matches = overlapping.filter((event) => hasIdentityHit(event, candidate));

  if (matches.length === 0) {
    const reason: AlertingV2EpisodeJoinSkipReason =
      overlapping.length === 0 ? 'no_temporal_overlap' : 'no_identity_hit';
    // Distinguish "nothing open" from "open but not relevant".
    if (openEvents.length === 0) {
      return { action: 'skip', reason: 'no_open_event' };
    }
    return { action: 'skip', reason };
  }

  if (matches.length > 1) {
    return { action: 'skip', reason: 'ambiguous_open_events' };
  }

  const event = matches[0];
  return {
    action: 'join',
    eventId: event.event_id,
    signal: buildAlertingV2EpisodeSignal(candidate),
  };
};

/** Rule / episode identity keys already present on an event's signals. */
export const extractAlertingV2EpisodeIds = (signals: SignalEntry[] | undefined): string[] => {
  const ids = (signals ?? [])
    .filter(
      (signal): signal is Extract<SignalEntry, { type: 'alerting_v2_episode' }> =>
        signal.type === 'alerting_v2_episode'
    )
    .map((signal) => signal.metadata.episode_id);
  return [...new Set(ids)];
};
