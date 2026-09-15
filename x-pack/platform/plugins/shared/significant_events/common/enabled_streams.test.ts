/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { parseEnabledStreamsSetting, serializeEnabledStreamsSetting } from './enabled_streams';

describe('parseEnabledStreamsSetting', () => {
  it('treats undefined and blank values as unset', () => {
    expect(parseEnabledStreamsSetting(undefined)).toEqual({
      configured: false,
      streamNames: [],
    });
    expect(parseEnabledStreamsSetting('')).toEqual({ configured: false, streamNames: [] });
    expect(parseEnabledStreamsSetting('   ')).toEqual({ configured: false, streamNames: [] });
  });

  it('parses a JSON allowlist, including an explicit empty list', () => {
    expect(parseEnabledStreamsSetting('[]')).toEqual({ configured: true, streamNames: [] });
    expect(parseEnabledStreamsSetting('["logs.app", " logs.nginx "]')).toEqual({
      configured: true,
      streamNames: ['logs.app', 'logs.nginx'],
    });
  });

  it('parses comma-separated names when the value is not JSON', () => {
    expect(parseEnabledStreamsSetting('logs.app, logs.nginx')).toEqual({
      configured: true,
      streamNames: ['logs.app', 'logs.nginx'],
    });
  });
});

describe('serializeEnabledStreamsSetting', () => {
  it('writes a stable sorted JSON array and drops duplicates', () => {
    expect(serializeEnabledStreamsSetting(['logs.nginx', 'logs.app', 'logs.app'])).toBe(
      '["logs.app","logs.nginx"]'
    );
    expect(serializeEnabledStreamsSetting([])).toBe('[]');
  });
});
