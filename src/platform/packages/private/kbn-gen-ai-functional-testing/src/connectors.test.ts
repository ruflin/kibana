/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import Fs from 'fs';
import Path from 'path';
import type Os from 'os';

jest.mock('@kbn/repo-info', () => {
  const fs = jest.requireActual('fs') as typeof Fs;
  const path = jest.requireActual('path') as typeof Path;
  const os = jest.requireActual('os') as typeof Os;
  return {
    REPO_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'kbn-gen-ai-functional-testing-')),
  };
});

import { REPO_ROOT } from '@kbn/repo-info';
import { AI_CONNECTORS_VAR_ENV, getAvailableConnectors } from './connectors';

const mockRepoRoot = REPO_ROOT;

const writeFileEnsureDir = (relativePath: string, contents: string) => {
  const abs = Path.join(mockRepoRoot, relativePath);
  Fs.mkdirSync(Path.dirname(abs), { recursive: true });
  Fs.writeFileSync(abs, contents);
};

const removeIfExists = (relativePath: string) => {
  const abs = Path.join(mockRepoRoot, relativePath);
  if (Fs.existsSync(abs)) {
    Fs.rmSync(abs);
  }
};

describe('getAvailableConnectors', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env[AI_CONNECTORS_VAR_ENV];
    delete process.env.CI;
    removeIfExists('config/kibana.dev.yml');
    removeIfExists('target/eis_models.json');
  });

  afterAll(() => {
    process.env = originalEnv;
    Fs.rmSync(mockRepoRoot, { recursive: true, force: true });
  });

  it('returns connectors from kibana.dev.yml when nothing else is configured', () => {
    writeFileEnsureDir(
      'config/kibana.dev.yml',
      [
        'xpack.actions.preconfigured:',
        '  my-openrouter-connector:',
        '    name: My OpenRouter',
        '    actionTypeId: .gen-ai',
        '    config:',
        '      apiProvider: Other',
        '      apiUrl: https://example.test/v1/chat/completions',
        '',
      ].join('\n')
    );

    const connectors = getAvailableConnectors();

    expect(connectors).toEqual([
      expect.objectContaining({ id: 'my-openrouter-connector', actionTypeId: '.gen-ai' }),
    ]);
  });

  it('merges EIS connectors from target/eis_models.json with kibana.dev.yml entries', () => {
    writeFileEnsureDir(
      'config/kibana.dev.yml',
      [
        'xpack.actions.preconfigured:',
        '  my-openrouter-connector:',
        '    name: My OpenRouter',
        '    actionTypeId: .gen-ai',
        '    config: { apiProvider: Other }',
        '',
      ].join('\n')
    );

    writeFileEnsureDir(
      'target/eis_models.json',
      JSON.stringify({
        models: [
          {
            inferenceId: '.google-gemini-2.5-pro-chat_completion',
            modelId: 'google-gemini-2.5-pro-chat_completion',
          },
        ],
      })
    );

    const ids = getAvailableConnectors().map((c) => c.id);
    expect(ids).toContain('my-openrouter-connector');
    expect(ids).toContain('eis-google-gemini-2.5-pro-chat_completion');
  });

  it('produces .inference connectors for EIS models with the expected shape', () => {
    writeFileEnsureDir(
      'target/eis_models.json',
      JSON.stringify({
        models: [
          {
            inferenceId: '.anthropic-claude-4.5-sonnet-chat_completion',
            modelId: 'anthropic-claude-4.5-sonnet-chat_completion',
          },
        ],
      })
    );

    const connectors = getAvailableConnectors();
    expect(connectors).toEqual([
      {
        id: 'eis-anthropic-claude-4.5-sonnet-chat_completion',
        name: 'EIS anthropic-claude-4.5-sonnet-chat_completion',
        actionTypeId: '.inference',
        config: {
          provider: 'elastic',
          taskType: 'chat_completion',
          inferenceId: '.anthropic-claude-4.5-sonnet-chat_completion',
        },
        secrets: {},
      },
    ]);
  });

  it('lets EIS-discovered connectors override colliding kibana.dev.yml entries', () => {
    writeFileEnsureDir(
      'config/kibana.dev.yml',
      [
        'xpack.actions.preconfigured:',
        '  eis-google-gemini-2.5-pro-chat_completion:',
        '    name: Stale Manually-Defined EIS',
        '    actionTypeId: .gen-ai',
        '    config: { apiProvider: Other }',
        '',
      ].join('\n')
    );

    writeFileEnsureDir(
      'target/eis_models.json',
      JSON.stringify({
        models: [
          {
            inferenceId: '.google-gemini-2.5-pro-chat_completion',
            modelId: 'google-gemini-2.5-pro-chat_completion',
          },
        ],
      })
    );

    const connectors = getAvailableConnectors();
    expect(connectors).toHaveLength(1);
    expect(connectors[0]).toMatchObject({
      id: 'eis-google-gemini-2.5-pro-chat_completion',
      actionTypeId: '.inference',
      name: 'EIS google-gemini-2.5-pro-chat_completion',
    });
  });

  it('prefers KIBANA_TESTING_AI_CONNECTORS over local files', () => {
    writeFileEnsureDir(
      'target/eis_models.json',
      JSON.stringify({
        models: [
          {
            inferenceId: '.google-gemini-2.5-pro-chat_completion',
            modelId: 'google-gemini-2.5-pro-chat_completion',
          },
        ],
      })
    );

    const envPayload = {
      'env-only-connector': {
        name: 'Env Only',
        actionTypeId: '.gen-ai',
        config: { apiProvider: 'Other' },
      },
    };
    process.env[AI_CONNECTORS_VAR_ENV] = Buffer.from(JSON.stringify(envPayload)).toString('base64');

    const connectors = getAvailableConnectors();
    expect(connectors).toEqual([
      expect.objectContaining({ id: 'env-only-connector', actionTypeId: '.gen-ai' }),
    ]);
  });

  it('does not read local files when CI is set, even if EIS models file is present', () => {
    writeFileEnsureDir(
      'target/eis_models.json',
      JSON.stringify({
        models: [
          {
            inferenceId: '.google-gemini-2.5-pro-chat_completion',
            modelId: 'google-gemini-2.5-pro-chat_completion',
          },
        ],
      })
    );
    process.env.CI = 'true';

    expect(() => getAvailableConnectors()).toThrow(/KIBANA_TESTING_AI_CONNECTORS/);
  });
});
