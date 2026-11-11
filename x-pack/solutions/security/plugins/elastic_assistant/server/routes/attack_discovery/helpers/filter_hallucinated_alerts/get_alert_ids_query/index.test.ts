/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getAlertIdsQuery } from '.';

describe('getAlertIdsQuery', () => {
  const alertsIndexPattern = '.alerts-security.alerts-*';

  it('returns the expected query for a single alert ID', () => {
    const result = getAlertIdsQuery(alertsIndexPattern, ['alert-1']).toRequest();

    expect(result).toEqual({
      query:
        'FROM .alerts-security.alerts-* METADATA _id | WHERE _id IN (?alertIds) | KEEP _id | LIMIT 1',
      params: [{ alertIds: ['alert-1'] }],
    });
  });

  it('returns the expected query for multiple alert IDs', () => {
    const alertIds = ['alert-1', 'alert-2', 'alert-3'];
    const result = getAlertIdsQuery(alertsIndexPattern, alertIds).toRequest();

    expect(result.query).toBe(
      'FROM .alerts-security.alerts-* METADATA _id | WHERE _id IN (?alertIds) | KEEP _id | LIMIT 3'
    );
    expect(result.params).toEqual([{ alertIds }]);
  });

  it('uses the provided index pattern', () => {
    const result = getAlertIdsQuery('.custom-alerts-*', ['alert-1']).toRequest();

    expect(result.query).toMatch(/^FROM \.custom-alerts-\* METADATA _id \|/);
  });

  it('sets the limit to match the number of alert IDs', () => {
    const alertIds = ['alert-1', 'alert-2', 'alert-3', 'alert-4', 'alert-5'];
    const result = getAlertIdsQuery(alertsIndexPattern, alertIds).toRequest();

    expect(result.query).toMatch(/\| LIMIT 5$/);
  });

  it.each(['.alerts-* | DROP kibana.alert.uuid', '.alerts-*\nFROM other', '"x"', '_hidden', ''])(
    'throws for the unsafe index pattern %j',
    (pattern) => {
      expect(() => getAlertIdsQuery(pattern, ['alert-1'])).toThrow(/Invalid index name/);
    }
  );
});
