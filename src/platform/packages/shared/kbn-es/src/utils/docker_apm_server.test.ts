/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { ToolingLog } from '@kbn/tooling-log';
import {
  APM_SERVER_CONTAINER_NAME,
  APM_SERVER_DEFAULT_IMAGE,
  getApmServerDockerCmd,
  getApmServerImage,
  runApmServerContainer,
} from './docker_apm_server';

jest.mock('execa');
const execa = jest.requireMock('execa');

const log = new ToolingLog();

describe('getApmServerImage()', () => {
  const originalImage = process.env.APM_SERVER_DOCKER_IMAGE;

  afterEach(() => {
    if (originalImage === undefined) {
      delete process.env.APM_SERVER_DOCKER_IMAGE;
    } else {
      process.env.APM_SERVER_DOCKER_IMAGE = originalImage;
    }
  });

  test('should default to the APM Server snapshot matching the Kibana version', () => {
    delete process.env.APM_SERVER_DOCKER_IMAGE;
    expect(getApmServerImage()).toBe(APM_SERVER_DEFAULT_IMAGE);
  });

  test('should allow overriding the image via APM_SERVER_DOCKER_IMAGE', () => {
    process.env.APM_SERVER_DOCKER_IMAGE = 'docker.elastic.co/apm/apm-server:9.0.0';
    expect(getApmServerImage()).toBe('docker.elastic.co/apm/apm-server:9.0.0');
  });
});

describe('getApmServerDockerCmd()', () => {
  test('should expose the APM Server under the hostname the serverless ES image exports to', () => {
    expect(getApmServerDockerCmd({ esHost: 'es01', esPort: 9200, ssl: true })).toEqual([
      'run',
      '--detach',
      '--net',
      'elastic',
      '--network-alias',
      'apm-server.elastic-agent',
      '--name',
      'es-serverless-apm-server',
      '-p',
      '127.0.0.1:8200:8200',
      getApmServerImage(),
      '--strict.perms=false',
      '-e',
      '-E',
      'apm-server.host=0.0.0.0:8200',
      '-E',
      'output.elasticsearch.hosts=["https://es01:9200"]',
      '-E',
      'output.elasticsearch.username=elastic_serverless',
      '-E',
      'output.elasticsearch.password=changeme',
      '-E',
      'output.elasticsearch.ssl.verification_mode=none',
    ]);
  });

  test('should use plain HTTP and skip TLS settings when ES runs without SSL', () => {
    const cmd = getApmServerDockerCmd({ esHost: 'es01', esPort: 9201, ssl: false });

    expect(cmd).toContain('output.elasticsearch.hosts=["http://es01:9201"]');
    expect(cmd).not.toContain('output.elasticsearch.ssl.verification_mode=none');
  });
});

describe('runApmServerContainer()', () => {
  test('should run the container and return its name', async () => {
    execa.mockResolvedValue({ stdout: 'containerId1234' });

    await expect(
      runApmServerContainer(log, { esHost: 'es01', esPort: 9200, ssl: true })
    ).resolves.toBe(APM_SERVER_CONTAINER_NAME);
    expect(execa).toHaveBeenCalledWith(
      'docker',
      getApmServerDockerCmd({ esHost: 'es01', esPort: 9200, ssl: true })
    );
  });
});
