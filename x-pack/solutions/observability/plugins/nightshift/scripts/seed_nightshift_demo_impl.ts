/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Seeds the Nightshift demo for local development: the claims pipeline logs, a source over
 * them, knowledge indicators, rules, detections and events, with the real pipeline paused.
 * No AI connector or inference call is needed. Run from the repo root against a local
 * serverless Observability Complete stack (or a stateful one):
 *
 *   node x-pack/solutions/observability/plugins/nightshift/scripts/seed_nightshift_demo.js
 *
 * Add --help to list the flags.
 */

import { Client } from '@elastic/elasticsearch';
import { run } from '@kbn/dev-cli-runner';
import { DEMO_EVENTS } from './demo/dataset';
import { resolveConnection } from './demo/connection';
import { seedAutomations } from './demo/automations';
import {
  cleanInvestigations,
  investigationConversationId,
  seedInvestigations,
} from './demo/investigations';
import { cleanAutomationsAndOnboarding, seedOnboarding } from './demo/onboarding';
import { cleanKnowledge, seedKnowledge } from './demo/knowledge';
import { runLiveMode } from './demo/live';
import {
  assertNightshiftAvailable,
  cleanDemoData,
  ensureSource,
  pauseSignificantEvents,
  resumeIfPaused,
  seedDetectionsAndEvents,
  seedKnowledgeIndicators,
  seedLogs,
  seedRules,
  type DemoContext,
} from './demo/steps';

/** Fixed RNG seed, so the synthetic logs have the same shape on every run. */
const FIXED_SEED = 42;

run(
  async ({ log, flags }) => {
    const { connection, insecureTls } = await resolveConnection(
      {
        esUrl: flags['es-url'] ? String(flags['es-url']) : undefined,
        kibanaUrl: flags['kibana-url'] ? String(flags['kibana-url']) : undefined,
        esUsername: flags['es-username'] ? String(flags['es-username']) : undefined,
        esPassword: flags['es-password'] ? String(flags['es-password']) : undefined,
        space: flags.space ? String(flags.space) : undefined,
      },
      log
    );
    const ctx: DemoContext = {
      connection,
      log,
      esClient: new Client({
        node: connection.esUrl,
        auth: connection.auth,
        ...(insecureTls ? { tls: { rejectUnauthorized: false } } : {}),
      }),
      seed: FIXED_SEED,
      generatedAtMs: Date.now(),
    };

    await assertNightshiftAvailable(ctx);
    await resumeIfPaused(ctx);
    if (flags.clean === true) {
      await cleanDemoData(ctx, (source) => cleanInvestigations(ctx, source));
      await cleanAutomationsAndOnboarding(ctx);
      await cleanKnowledge(ctx);
    }

    const { manifest, streamName } = await seedLogs(ctx);
    const source = await ensureSource(ctx, streamName);
    const features = await seedKnowledgeIndicators(ctx, source, manifest);
    const rules = await seedRules(ctx, source);
    // Investigations and automations are written before the pause, because manual triggers are
    // blocked while Significant Events is paused. Onboarding reads an investigation, so it comes after.
    await seedInvestigations(ctx, source, rules, features, DEMO_EVENTS);
    await seedAutomations(ctx);
    await seedOnboarding(ctx);
    await seedKnowledge(ctx);
    await pauseSignificantEvents(ctx);
    // An active event is still under investigation; a dismissed one has a finished investigation.
    await seedDetectionsAndEvents(ctx, source, rules, features, DEMO_EVENTS, (event) => ({
      conversationId: investigationConversationId(source, event),
      completed: event.status !== 'active',
    }));

    if (flags.live === true) {
      await runLiveMode(ctx, source, rules, features);
    }

    log.info('Done.');
  },
  {
    description: 'Nightshift demo seed: claims pipeline logs, KIs, rules, detections and events.',
    flags: {
      string: ['es-url', 'kibana-url', 'space', 'es-username', 'es-password'],
      boolean: ['clean', 'live'],
      help: `
        --es-url <url>         Elasticsearch URL (default: detected, https://localhost:9200 then http)
        --es-username <user>   Elasticsearch user (default: detected, elastic_serverless then elastic)
        --es-password <pass>   Elasticsearch password (default: changeme)
        --kibana-url <url>     Kibana base URL (default: detected, https://localhost:5601 then http)
        --space <id>           Kibana space to seed (default: default)
        --clean                Delete the demo source, detections and events before seeding
        --live                 After seeding, raise a new scripted event every 2 minutes until Ctrl+C

        Notes:
          Needs Nightshift enabled: a serverless Observability Complete stack, or a stateful stack
          with the nightshift feature flags.
          Significant Events is paused after the rules are created, so they do not act on the
          demo data. Resume it from the settings page when you are done.
          Logs are not removed by --clean: they are time-bounded and rewritten on every run.
      `,
    },
  }
);
