/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { DEMO_TAG } from './dataset';
import { bulkCreate, esRequest, kibanaRequest } from './http';
import type { HttpResult } from './http';
import type { DemoContext } from './steps';

const EXECUTIONS_INDEX = '.workflows-executions';
/** Prefix on the ids of demo automation runs, so `--clean` removes only them. */
export const DEMO_AUTOMATION_RUN_ID_PREFIX = 'nightshift-demo-automation-run-';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SEED_RANDOM_MULTIPLIER = 1_664_525;
const SEED_RANDOM_INCREMENT = 1_013_904_223;
const SEED_RANDOM_MODULUS = 4_294_967_296;

type RunStatus = 'completed' | 'failed' | 'running' | 'skipped';
type TriggerKind = 'alert' | 'slack' | 'schedule';

interface DemoAutomation {
  name: string;
  trigger: Record<string, string | number | string[] | number[]>;
  completions?: Array<Record<string, string>>;
  promptTemplate?: string;
  tags: string[];
  enabled: boolean;
  dailyDispatchLimit: number;
  runs48h: number;
  runsToday: number;
  failed: number;
  running: number;
  skipped: number;
}

const THREAD_REPLY = { action: 'post_to_slack', targetMode: 'thread' };

/** Claims-team automations: alert and Slack triggers reply in threads, the daily review is scheduled. */
const DEMO_AUTOMATIONS: DemoAutomation[] = [
  {
    name: 'Triage fraud gateway alerts',
    trigger: {
      kind: 'alert',
      ruleNamePattern: 'fraud gateway',
      ruleNameMatchMode: 'substring',
      alertStatus: 'active',
    },
    completions: [{ action: 'post_to_slack', targetMode: 'channel', destination: '#claims-ops' }],
    tags: ['triage', 'alerts'],
    enabled: true,
    dailyDispatchLimit: 20,
    runs48h: 26,
    runsToday: 9,
    failed: 2,
    running: 1,
    skipped: 2,
  },
  {
    name: 'Thread on claims incidents',
    trigger: { kind: 'slack', event: 'message', channels: ['#claims-incidents'] },
    completions: [THREAD_REPLY],
    tags: ['incidents', 'p1'],
    enabled: true,
    dailyDispatchLimit: 10,
    runs48h: 7,
    runsToday: 3,
    failed: 1,
    running: 0,
    skipped: 1,
  },
  {
    name: 'Daily claims pipeline assessment',
    trigger: { kind: 'schedule', schedulePreset: 'daily', time: '08:00', timezone: 'UTC' },
    completions: [{ action: 'post_to_slack', targetMode: 'channel', destination: '#claims-ops' }],
    promptTemplate:
      'Review the last 24 hours of claims pipeline telemetry. Summarize errors, latency changes and affected services, and name the most likely cause of any incident.',
    tags: ['reporting', 'claims'],
    enabled: true,
    dailyDispatchLimit: 5,
    runs48h: 2,
    runsToday: 1,
    failed: 0,
    running: 0,
    skipped: 0,
  },
  {
    name: 'Weekly fraud-check review',
    trigger: {
      kind: 'schedule',
      schedulePreset: 'weekly',
      time: '09:30',
      timezone: 'UTC',
      daysOfWeek: [1],
    },
    promptTemplate:
      'Compare fraud-check error rates and latency for the last 7 days with the previous 7 days, and list the days with the largest changes.',
    tags: ['reporting', 'fraud'],
    enabled: false,
    dailyDispatchLimit: 5,
    runs48h: 0,
    runsToday: 0,
    failed: 0,
    running: 0,
    skipped: 0,
  },
];

/** Seeded pseudo-random numbers in [0, 1), so re-running the seed writes the same run history. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * SEED_RANDOM_MULTIPLIER + SEED_RANDOM_INCREMENT) % SEED_RANDOM_MODULUS;
    return state / SEED_RANDOM_MODULUS;
  };
};

const expectOk = <T>(result: HttpResult<T>, what: string): T => {
  if (result.status >= 300) {
    throw new Error(`${what} failed (HTTP ${result.status}): ${JSON.stringify(result.data)}`);
  }
  return result.data;
};

const triggerKindOf = (automation: DemoAutomation): TriggerKind =>
  automation.trigger.kind as TriggerKind;

const randomTimes = (start: number, end: number, count: number, random: () => number): number[] =>
  Array.from({ length: count }, () => start + random() * (end - start)).sort((a, b) => a - b);

const runStatuses = (automation: DemoAutomation, random: () => number): RunStatus[] => {
  const finished = automation.runs48h - automation.running;
  const statuses: RunStatus[] = Array.from({ length: finished }, (_, index) => {
    if (index < automation.failed) {
      return 'failed';
    }
    return index < automation.failed + automation.skipped ? 'skipped' : 'completed';
  });
  // Shuffle so failed and skipped runs are spread over the window.
  for (let index = statuses.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [statuses[index], statuses[swap]] = [statuses[swap], statuses[index]];
  }
  return [...statuses, ...Array<RunStatus>(automation.running).fill('running')];
};

const runDocument = (
  runId: string,
  workflowId: string,
  automation: DemoAutomation,
  startedAt: number,
  status: RunStatus,
  random: () => number
): Record<string, unknown> => {
  const duration = status === 'skipped' ? 0 : 20_000 + Math.floor(random() * 580_000);
  const iso = (epochMs: number): string => new Date(epochMs).toISOString();
  return {
    id: runId,
    spaceId: 'default',
    workflowId,
    isTestRun: false,
    status,
    createdAt: iso(startedAt),
    startedAt: iso(startedAt),
    ...(status === 'running' ? {} : { finishedAt: iso(startedAt + duration), duration }),
    triggeredBy: triggerKindOf(automation),
    workflowDefinition: { name: automation.name, tags: ['nightshift', 'automation', DEMO_TAG] },
  };
};

/** Removes the demo automations (matched by tag) and their run history. */
const removeDemoAutomations = async (ctx: DemoContext): Promise<void> => {
  const list = expectOk(
    await kibanaRequest<{ automations: Array<{ id: string; name: string; tags?: string[] }> }>(
      ctx.connection,
      'GET',
      '/internal/nightshift/automations'
    ),
    'List automations'
  );
  for (const automation of list.automations.filter(({ tags }) => tags?.includes(DEMO_TAG))) {
    expectOk(
      await kibanaRequest(
        ctx.connection,
        'DELETE',
        `/internal/nightshift/automations/${automation.id}`
      ),
      `Delete automation "${automation.name}"`
    );
    ctx.log.info(`Deleted demo automation "${automation.name}"`);
  }
  expectOk(
    await esRequest(
      ctx.connection,
      'POST',
      `/${EXECUTIONS_INDEX}/_delete_by_query?refresh=true&conflicts=proceed`,
      { query: { prefix: { id: DEMO_AUTOMATION_RUN_ID_PREFIX } } }
    ),
    'Delete demo automation runs'
  );
};

/** Creates the claims-team automations and writes their run history into the workflow executions index. */
export const seedAutomations = async (ctx: DemoContext): Promise<void> => {
  await removeDemoAutomations(ctx);
  const random = seededRandom(ctx.seed);
  const now = Date.now();
  const midnight = new Date(now).setUTCHours(0, 0, 0, 0);

  for (const automation of DEMO_AUTOMATIONS) {
    const created = expectOk(
      await kibanaRequest<{ workflowId: string }>(
        ctx.connection,
        'POST',
        '/internal/nightshift/automations',
        {
          name: automation.name,
          tags: [...automation.tags, DEMO_TAG],
          isEnabled: automation.enabled,
          trigger: { rows: [automation.trigger] },
          execution: automation.promptTemplate ? { promptTemplate: automation.promptTemplate } : {},
          completions: automation.completions ?? [],
          runtime: { dailyDispatchLimit: automation.dailyDispatchLimit },
        }
      ),
      `Create automation "${automation.name}"`
    );

    const times = [
      ...randomTimes(now - 2 * DAY_MS, midnight, automation.runs48h - automation.runsToday, random),
      ...randomTimes(midnight, now, automation.runsToday, random),
    ];
    const statuses = runStatuses(automation, random);
    const documents = times.map((startedAt, index) =>
      runDocument(
        `${DEMO_AUTOMATION_RUN_ID_PREFIX}${created.workflowId}-${index}`,
        created.workflowId,
        automation,
        startedAt,
        statuses[index],
        random
      )
    );
    await bulkCreate(ctx.connection, EXECUTIONS_INDEX, documents);
    ctx.log.info(
      `${automation.name}: ${automation.runs48h} runs in 48h, ${automation.runsToday} today, ${
        automation.enabled ? 'enabled' : 'disabled'
      }`
    );
  }
};

/** Removes the demo automations and their run history. */
export const cleanAutomations = async (ctx: DemoContext): Promise<void> => {
  await removeDemoAutomations(ctx);
};
