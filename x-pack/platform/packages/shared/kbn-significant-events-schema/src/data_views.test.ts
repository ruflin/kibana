/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getViewName, getViewNames } from './data_views';

describe('getViewName', () => {
  it('prefers view_name when both fields are present', () => {
    expect(getViewName({ view_name: '$.nightshift.default.logs', stream_name: 'logs.app' })).toBe(
      '$.nightshift.default.logs'
    );
  });

  it('falls back to stream_name for stored documents', () => {
    expect(getViewName({ stream_name: 'logs.app' })).toBe('logs.app');
  });

  it('returns undefined when neither field is present', () => {
    expect(getViewName({})).toBeUndefined();
  });
});

describe('getViewNames', () => {
  it('prefers view_names when both fields are present', () => {
    expect(
      getViewNames({
        view_names: ['$.nightshift.default.logs'],
        stream_names: ['logs.app'],
      })
    ).toEqual(['$.nightshift.default.logs']);
  });

  it('falls back to stream_names for stored documents', () => {
    expect(getViewNames({ stream_names: ['logs.app', 'logs.api'] })).toEqual([
      'logs.app',
      'logs.api',
    ]);
  });

  it('returns an empty array when neither field is present', () => {
    expect(getViewNames({})).toEqual([]);
  });
});
