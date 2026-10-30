/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { DEMO_EVENT_ID_PREFIX, DEMO_LIVE_EVENTS } from './dataset';
import { bulkCreate } from './http';
import type { DemoContext, DemoFeatures, DemoRule, DemoSource } from './steps';
import { DETECTIONS_INDEX, EVENTS_DATA_STREAM, buildDetection, buildEventDocument } from './steps';

const LIVE_INTERVAL_MS = 2 * 60_000;

/** Raises the next scripted event every few minutes until the process is stopped with Ctrl+C. */
export const runLiveMode = async (
  ctx: DemoContext,
  source: DemoSource,
  rules: DemoRule[],
  features: DemoFeatures
): Promise<void> => {
  const space = ctx.connection.space;
  let next = 0;

  const raiseNext = async (): Promise<void> => {
    const event = DEMO_LIVE_EVENTS[next % DEMO_LIVE_EVENTS.length];
    next += 1;
    const eventId = `${DEMO_EVENT_ID_PREFIX}live-${Date.now()}`;
    const raisedAtMs = Date.now();
    await bulkCreate(ctx.connection, DETECTIONS_INDEX, [
      buildDetection(source, rules, event, eventId, space, raisedAtMs),
    ]);
    await bulkCreate(ctx.connection, EVENTS_DATA_STREAM, [
      buildEventDocument(source, rules, features, event, eventId, space, raisedAtMs),
    ]);
    ctx.log.info(`Live: raised "${event.title}"`);
  };

  await raiseNext();
  const timer = setInterval(() => {
    raiseNext().catch((error: Error) => ctx.log.error(`Live tick failed: ${error.message}`));
  }, LIVE_INTERVAL_MS);

  ctx.log.info('Live mode running. Press Ctrl+C to stop.');
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      clearInterval(timer);
      resolve();
    });
  });
};
