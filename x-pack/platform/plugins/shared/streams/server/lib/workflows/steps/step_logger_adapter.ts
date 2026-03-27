/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/logging';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';

type StepLogger = StepHandlerContext['logger'];

/**
 * Adapts the workflow step logger (simplified interface) to the Kibana Logger
 * interface expected by Streams domain functions. Methods not available on the
 * step logger are no-ops.
 */
export function createStepLoggerAdapter(stepLogger: StepLogger): Logger {
  const noop = () => {};
  return {
    trace: noop,
    debug: (messageOrFn: string | (() => string), meta?: object) => {
      const msg = typeof messageOrFn === 'function' ? messageOrFn() : messageOrFn;
      stepLogger.debug(msg, meta);
    },
    info: (message: string, meta?: object) => stepLogger.info(message, meta),
    warn: (message: string, meta?: object) => stepLogger.warn(message, meta),
    error: (messageOrError: string | Error, meta?: object) => {
      const msg = messageOrError instanceof Error ? messageOrError.message : String(messageOrError);
      stepLogger.error(msg, messageOrError instanceof Error ? messageOrError : undefined);
    },
    fatal: (message: string) => stepLogger.error(message),
    log: noop,
    isLevelEnabled: () => true,
    get: () => createStepLoggerAdapter(stepLogger),
  } as unknown as Logger;
}
