/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import chalk from 'chalk';
import execa from 'execa';
import type { ToolingLog } from '@kbn/tooling-log';
import { kibanaPackageJson as pkg } from '@kbn/repo-info';
import {
  ELASTIC_SERVERLESS_SUPERUSER,
  ELASTIC_SERVERLESS_SUPERUSER_PASSWORD,
} from './serverless_file_realm';

export const APM_SERVER_DEFAULT_IMAGE = `docker.elastic.co/apm/apm-server:${pkg.version}-SNAPSHOT`;
export const APM_SERVER_CONTAINER_NAME = 'es-serverless-apm-server';
export const APM_SERVER_PORT = 8200;

/**
 * The serverless ES image ships with telemetry exporters (APM agent traces and OTLP metrics) pointing at
 * `http://apm-server.elastic-agent:8200`. Registering this alias on the `elastic` Docker network makes that
 * default endpoint resolvable without overriding any ES telemetry endpoint settings.
 */
export const APM_SERVER_NETWORK_ALIAS = 'apm-server.elastic-agent';

export interface ApmServerContainerOptions {
  /** Hostname of the ES node (on the `elastic` network) that APM Server indexes into */
  esHost: string;
  /** Port of the ES node inside the `elastic` network */
  esPort: number;
  /** Whether ES serves HTTP over TLS */
  ssl?: boolean;
}

export const getApmServerImage = (): string =>
  process.env.APM_SERVER_DOCKER_IMAGE || APM_SERVER_DEFAULT_IMAGE;

/**
 * Builds the `docker run` arguments for an APM Server that receives serverless ES telemetry and indexes it
 * back into the local serverless ES cluster.
 */
export const getApmServerDockerCmd = ({
  esHost,
  esPort,
  ssl,
}: ApmServerContainerOptions): string[] => [
  'run',
  '--detach',
  '--net',
  'elastic',
  '--network-alias',
  APM_SERVER_NETWORK_ALIAS,
  '--name',
  APM_SERVER_CONTAINER_NAME,
  '-p',
  `127.0.0.1:${APM_SERVER_PORT}:${APM_SERVER_PORT}`,
  getApmServerImage(),
  '--strict.perms=false',
  '-e',
  '-E',
  `apm-server.host=0.0.0.0:${APM_SERVER_PORT}`,
  '-E',
  `output.elasticsearch.hosts=["${ssl ? 'https' : 'http'}://${esHost}:${esPort}"]`,
  '-E',
  `output.elasticsearch.username=${ELASTIC_SERVERLESS_SUPERUSER}`,
  '-E',
  `output.elasticsearch.password=${ELASTIC_SERVERLESS_SUPERUSER_PASSWORD}`,
  // The ES node certificate is not issued for the in-network container hostname.
  ...(ssl ? ['-E', 'output.elasticsearch.ssl.verification_mode=none'] : []),
];

/**
 * Runs an APM Server container that collects serverless ES traces and metrics.
 */
export const runApmServerContainer = async (
  log: ToolingLog,
  options: ApmServerContainerOptions
): Promise<string> => {
  const dockerCmd = getApmServerDockerCmd(options);

  log.info(chalk.bold(`Running "${APM_SERVER_CONTAINER_NAME}" container for ES telemetry`));
  log.indent(4, () => log.info(chalk.dim(`docker ${dockerCmd.join(' ')}`)));

  const { stdout: containerId } = await execa('docker', dockerCmd);

  log.indent(4, () =>
    log.info(`APM Server is running and reachable from ES as ${chalk.bold(
      `http://${APM_SERVER_NETWORK_ALIAS}:${APM_SERVER_PORT}`
    )}.
  Container Name: ${APM_SERVER_CONTAINER_NAME}
  Container Id:   ${containerId}
  Host endpoint:  ${chalk.bold(
    `http://localhost:${APM_SERVER_PORT}`
  )} (APM intake and OTLP gRPC, e.g. for Kibana's telemetry.tracing / telemetry.metrics exporters)

  View logs:            ${chalk.bold(`docker logs -f ${APM_SERVER_CONTAINER_NAME}`)}
`)
  );

  return APM_SERVER_CONTAINER_NAME;
};
