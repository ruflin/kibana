/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Seeds the Nightshift demo for local development: the claims pipeline logs, a source over
 * them, knowledge indicators, rules, detections and events, with the real pipeline paused.
 * No AI connector or inference call is needed. Run from the repo root:
 *
 *   node -r @kbn/setup-node-env x-pack/solutions/observability/plugins/nightshift/scripts/seed_nightshift_demo.ts
 *
 * Add --help to list the flags.
 */

import { Client } from '@elastic/elasticsearch';
import { run } from '@kbn/dev-cli-runner';
import { DEMO_EVENTS } from './demo/dataset';
import type { DemoConnection } from './demo/http';
import { runLiveMode } from './demo/live';
import {
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
    const auth = {
      username: String(flags['es-username'] || 'elastic'),
      password: String(flags['es-password'] || 'changeme'),
    };
    const connection: DemoConnection = {
      esUrl: String(flags['es-url'] || 'http://localhost:9200'),
      kibanaUrl: String(flags['kibana-url'] || 'http://localhost:5601'),
      space: String(flags.space || 'default'),
      auth,
    };
    const ctx: DemoContext = {
      connection,
      log,
      esClient: new Client({ node: connection.esUrl, auth }),
      seed: FIXED_SEED,
      generatedAtMs: Date.now(),
    };

    await resumeIfPaused(ctx);
    if (flags.clean === true) {
      await cleanDemoData(ctx);
    }

    const { manifest, streamName } = await seedLogs(ctx);
    const source = await ensureSource(ctx, streamName);
    const features = await seedKnowledgeIndicators(ctx, source, manifest);
    const rules = await seedRules(ctx, source);
    await pauseSignificantEvents(ctx);
    await seedDetectionsAndEvents(ctx, source, rules, features, DEMO_EVENTS);

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
        --es-url <url>         Elasticsearch URL (default: http://localhost:9200)
        --es-username <user>   Elasticsearch user (default: elastic)
        --es-password <pass>   Elasticsearch password (default: changeme)
        --kibana-url <url>     Kibana base URL (default: http://localhost:5601)
        --space <id>           Kibana space to seed (default: default)
        --clean              Delete the demo source, detections and events before seeding
        --live               After seeding, raise a new scripted event every 2 minutes until Ctrl+C

        Notes:
          Significant Events is paused after the rules are created, so they do not act on the
          demo data. Resume it from the settings page when you are done.
          Logs are not removed by --clean: they are time-bounded and rewritten on every run.
      `,
    },
  }
);
