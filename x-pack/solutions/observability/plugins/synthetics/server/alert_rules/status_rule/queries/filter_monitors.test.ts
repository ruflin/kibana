/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getFilters, queryFilterMonitors } from './filter_monitors';

describe('getFilters', () => {
  it('returns an empty array when all parameters are empty', () => {
    const ruleParams = { monitorTypes: [], locations: [], tags: [], projects: [] };
    expect(getFilters(ruleParams)).toEqual([]);
  });

  it('creates a terms filter for monitorTypes', () => {
    const ruleParams = { monitorTypes: ['http', 'tcp'], locations: [], tags: [], projects: [] };
    expect(getFilters(ruleParams)).toEqual([{ terms: { 'monitor.type': ['http', 'tcp'] } }]);
  });

  it('creates a terms filter for locations', () => {
    const ruleParams = {
      monitorTypes: [],
      locations: ['us-east', 'us-west'],
      tags: [],
      projects: [],
    };
    expect(getFilters(ruleParams)).toEqual([
      { terms: { 'observer.name': ['us-east', 'us-west'] } },
    ]);
  });

  it('creates a bool must filter for tags', () => {
    const ruleParams = { monitorTypes: [], locations: [], tags: ['tag1', 'tag2'], projects: [] };
    expect(getFilters(ruleParams)).toEqual([
      {
        terms: { tags: ['tag1', 'tag2'] },
      },
    ]);
  });

  it('creates a terms filter for projects', () => {
    const ruleParams = { monitorTypes: [], locations: [], tags: [], projects: ['proj1', 'proj2'] };
    expect(getFilters(ruleParams)).toEqual([
      { terms: { 'monitor.project.id': ['proj1', 'proj2'] } },
    ]);
  });

  it('handles all filters together', () => {
    const ruleParams = {
      monitorTypes: ['http'],
      locations: ['us-east'],
      tags: ['tag1', 'tag2'],
      projects: ['proj1'],
    };
    expect(getFilters(ruleParams)).toEqual([
      { terms: { 'monitor.type': ['http'] } },
      { terms: { 'observer.name': ['us-east'] } },
      {
        terms: { tags: ['tag1', 'tag2'] },
      },
      { terms: { 'monitor.project.id': ['proj1'] } },
    ]);
  });

  it('ignores undefined fields', () => {
    const ruleParams = {
      monitorTypes: undefined,
      locations: undefined,
      tags: undefined,
      projects: undefined,
    };
    expect(getFilters(ruleParams)).toEqual([]);
  });

  it('ignores empty values in an otherwise valid object', () => {
    const ruleParams = { monitorTypes: [], locations: ['us-east'], tags: [], projects: [] };
    expect(getFilters(ruleParams)).toEqual([{ terms: { 'observer.name': ['us-east'] } }]);
  });
});

describe('queryFilterMonitors', () => {
  const ruleParams = { monitorTypes: [], locations: [], tags: [], projects: [], kqlQuery: 'x: 1' };

  it('returns undefined without a valid KQL query', async () => {
    const esql = jest.fn();
    const esClient = { esql, heartbeatIndices: 'synthetics-*' } as any;

    expect(
      await queryFilterMonitors({ spaceId: 'default', esClient, ruleParams: {} as any })
    ).toBeUndefined();
    expect(esql).not.toHaveBeenCalled();
  });

  it('groups the matching monitors by config_id', async () => {
    const esql = jest.fn().mockResolvedValue({
      columns: [{ name: 'config_id', type: 'keyword' }],
      values: [['a'], ['b']],
    });
    const esClient = { esql, heartbeatIndices: 'synthetics-*' } as any;

    const ids = await queryFilterMonitors({
      spaceId: 'default',
      esClient,
      ruleParams: ruleParams as any,
    });

    expect(ids).toEqual(['a', 'b']);
    expect(esql.mock.calls[0][0].toRequest().query).toBe(
      'FROM synthetics-* | STATS BY config_id | LIMIT 10000'
    );
    expect(esql.mock.calls[0][1].filter.bool.filter).toContainEqual({
      terms: { 'meta.space_id': ['default', '*'] },
    });
  });
});
