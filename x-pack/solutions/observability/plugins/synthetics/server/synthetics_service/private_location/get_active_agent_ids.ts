/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { SYNTHETICS_INDEX_PATTERN } from '../../../common/constants';
import { getAPIKeyForSyntheticsService } from '../get_api_key';
import { getFakeKibanaRequest } from '../utils/fake_kibana_request';
import type { SyntheticsServerSetup } from '../../types';
import { getPrivateLocationShardingApiKey } from './get_sharding_api_key';

/**
 * Data-plane liveness signal: which of the given agents have written a
 * `synthetics-*` document within `windowMs`. A running Heartbeat keeps indexing
 * results even when its Fleet check-in is failing (the control plane is easily
 * disrupted by proxy idle-timeouts, Fleet Server restarts or network blips),
 * so a recent write is proof an agent is alive and executing — used to veto a
 * false-positive staleness eviction that would move monitors it is still
 * running (a real at-most-once break).
 *
 * Only ever used to *keep* an agent, never to trigger an eviction: an agent with
 * no assigned monitors (or only long-schedule ones) legitimately writes nothing,
 * so absence of data is ambiguous and falls back to the check-in signal.
 *
 * The task runs as `kibana_system`, which cannot read `synthetics-*`. When a
 * service manifest or dev URL is configured we query with the Synthetics service
 * API key, and use the sharding key only if that key is missing or invalid.
 * Self-managed installs have neither URL, so we read the sharding key only.
 * Correlation is on `agent.id` because synthetics documents carry `agent.id`,
 * not `host.name`. Best-effort: any failure returns an empty set so the caller
 * falls back to check-ins alone — this never triggers an eviction, only prevents
 * one.
 */
export const getRecentlyActiveAgentIds = async (
  server: SyntheticsServerSetup,
  agentIds: string[],
  windowMs: number,
  now: number,
  signal: AbortSignal
): Promise<Set<string>> => {
  const active = new Set<string>();
  if (agentIds.length === 0) {
    return active;
  }

  try {
    signal.throwIfAborted();
    const shouldUseServiceApiKey = Boolean(
      server.config.service?.manifestUrl || server.config.service?.devUrl
    );
    const serviceApiKey = shouldUseServiceApiKey
      ? await getAPIKeyForSyntheticsService({ server })
      : undefined;
    const { apiKey, isValid } = serviceApiKey?.isValid
      ? serviceApiKey
      : await getPrivateLocationShardingApiKey({ server });
    if (!apiKey || !isValid) {
      return active;
    }

    const esClient = server.coreStart.elasticsearch.client.asScoped(
      getFakeKibanaRequest({ id: apiKey.id, api_key: apiKey.apiKey })
    ).asCurrentUser;

    // A missing index is an ES|QL error, which the best-effort catch below turns into an empty set.
    const result = await esClient.esql.query(
      esql.from([SYNTHETICS_INDEX_PATTERN]).pipe`WHERE @timestamp >= TO_DATETIME(${{
        since: new Date(now - windowMs).toISOString(),
      }})`.pipe`WHERE agent.id IN (${{ agentIds }})`.pipe`STATS BY agent.id`
        .limit(agentIds.length)
        .toRequest() as unknown as EsqlQueryRequest,
      { signal }
    );

    const agentIdColumn = (result as unknown as ESQLSearchResponse).columns.findIndex(
      ({ name }) => name === 'agent.id'
    );
    for (const row of (result as unknown as ESQLSearchResponse).values) {
      const agentId = row[agentIdColumn];
      if (typeof agentId === 'string') {
        active.add(agentId);
      }
    }
  } catch (e) {
    if (signal.aborted) {
      throw e;
    }
    server.logger.debug(
      `[RebalancePrivateLocationShardsTask] synthetics-* liveness query failed; ` +
        `falling back to check-in signal only: ${e.message}`
    );
  }

  return active;
};
