/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isSystemEsqlView, toOwnedViewName } from './view_names';

describe('isSystemEsqlView', () => {
  it('hides known plugin-owned system views', () => {
    expect(isSystemEsqlView('$.rule-events')).toBe(true);
    expect(isSystemEsqlView('$.alert-actions')).toBe(true);
    expect(isSystemEsqlView('$.alert-episodes')).toBe(true);
  });

  it('allows user and nightshift views', () => {
    expect(isSystemEsqlView('$.nightshift.default.prod-logs')).toBe(false);
    expect(isSystemEsqlView('$.logs.checkout')).toBe(false);
  });
});

describe('toOwnedViewName', () => {
  it('namespaces created views under $.nightshift.{space}.{id}', () => {
    expect(toOwnedViewName({ id: 'prod logs', spaceId: 'default' })).toBe(
      '$.nightshift.default.prod-logs'
    );
  });

  it('does not use a user-supplied $. prefix as the ES view name', () => {
    expect(toOwnedViewName({ id: '$.logs.checkout', spaceId: 'default' })).toBe(
      '$.nightshift.default.logs.checkout'
    );
  });

  it('throws when the slug is empty', () => {
    expect(() => toOwnedViewName({ id: '   ', spaceId: 'default' })).toThrow(
      'View name is required'
    );
  });
});
