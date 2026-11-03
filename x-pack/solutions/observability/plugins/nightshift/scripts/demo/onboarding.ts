/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { OnboardingSuggestion } from '@kbn/nightshift-investigations-plugin/common';
import { cleanAutomations } from './automations';
import { esRequest } from './http';
import type { DemoContext } from './steps';

const EXECUTIONS_INDEX = '.workflows-executions';
const WORKFLOW_ID = 'system-nightshift-onboarding-suggestions';
/** Prefix on the id of the demo onboarding run, so `--clean` removes only it. */
const EXECUTION_ID_PREFIX = 'nightshift-demo-onboarding-';
const RUN_DURATION_MS = 150_000;

/** Suggestions the exploration returns for the claims pipeline in the demo. */
const SUGGESTIONS: OnboardingSuggestion[] = [
  {
    title: 'claim-intake: 5xx errors up 4x in the last hour',
    prompt:
      'claim-intake returned about 1,800 HTTP 5xx responses in the last hour, against about 450 per hour over the previous 23 hours. Most come from fraud-check timeouts. What started the spike, and is fraud-check the only cause?',
    rationale:
      'claim-intake 5xx rate is up 4x in the last hour, and most errors trace to fraud-check.',
    source: 'error_spike',
  },
  {
    title: 'Primary fraud gateway timeouts is active on fraud-check',
    prompt:
      'The "Primary fraud gateway timeouts" rule is active on fraud-check, with about 70% of requests timing out. Which downstream call is slow, and when did it start?',
    rationale: 'Active alert on fraud-check, the first significant event in this space.',
    source: 'alert',
  },
  {
    title: 'payment-processor: p99 latency up from 0.9s to 3.8s',
    prompt:
      'payment-processor p99 latency rose from about 0.9s to 3.8s over the last 2 hours while its traffic stayed flat. Is it waiting on fraud-check, or on the database?',
    rationale: 'p99 is about 4x higher at flat traffic, and payment-processor calls fraud-check.',
    source: 'latency',
  },
  {
    title: 'fraud-check 4.8.0 was deployed before the timeouts began',
    prompt:
      'fraud-check 4.8.0 was deployed about 25 minutes before the first timeouts. The release changes the gateway client timeout. Did this release cause the failures?',
    rationale: 'Deployment shortly before the first timeouts, and it changes the gateway client.',
    source: 'code_change',
  },
  {
    title: 'postgres: connection pool waits rising during claim retries',
    prompt:
      'postgres connection pool waits are climbing while claim-intake retries. Is the database the bottleneck, or a symptom of fraud-check timeouts?',
    rationale: 'Pool waits rise with the retry volume from claim-intake.',
    source: 'other',
  },
];

/** Replaces the demo onboarding run in the space with a succeeded exploration, so step 2 shows the suggestions. */
export const seedOnboarding = async (ctx: DemoContext): Promise<void> => {
  await removeDemoOnboarding(ctx);
  const spaceId = ctx.connection.space;
  const id = `${EXECUTION_ID_PREFIX}succeeded`;
  const startedAt = Date.now() - RUN_DURATION_MS;
  const finishedAt = startedAt + RUN_DURATION_MS;
  const response = await esRequest(
    ctx.connection,
    'PUT',
    `/${EXECUTIONS_INDEX}/_doc/${id}?refresh=true`,
    {
      id,
      spaceId,
      workflowId: WORKFLOW_ID,
      isTestRun: false,
      status: 'completed',
      createdAt: new Date(startedAt).toISOString(),
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      duration: RUN_DURATION_MS,
      triggeredBy: 'nightshift-onboarding',
      concurrencyGroupKey: `nightshift-onboarding-suggestions-${spaceId}`,
      workflowDefinition: { name: 'Nightshift Onboarding Suggestions', tags: ['nightshift'] },
      context: {
        spaceId,
        inputs: {},
        triggeredBy: 'nightshift-onboarding',
        output: { suggestions: SUGGESTIONS },
      },
    }
  );
  if (response.status >= 300) {
    throw new Error(`Write onboarding run failed (HTTP ${response.status})`);
  }
  ctx.log.info(`Wrote onboarding run with ${SUGGESTIONS.length} suggestions`);
};

/** Removes the demo onboarding run. */
const removeDemoOnboarding = async (ctx: DemoContext): Promise<void> => {
  const response = await esRequest(
    ctx.connection,
    'POST',
    `/${EXECUTIONS_INDEX}/_delete_by_query?refresh=true&conflicts=proceed`,
    {
      query: {
        bool: {
          filter: [{ term: { workflowId: WORKFLOW_ID } }, { prefix: { id: EXECUTION_ID_PREFIX } }],
        },
      },
    }
  );
  if (response.status >= 300) {
    throw new Error(`Delete demo onboarding run failed (HTTP ${response.status})`);
  }
};

/** Removes the demo automations, their run history and the demo onboarding run. */
export const cleanAutomationsAndOnboarding = async (ctx: DemoContext): Promise<void> => {
  await cleanAutomations(ctx);
  await removeDemoOnboarding(ctx);
  ctx.log.info('Deleted demo automations and onboarding run');
};
