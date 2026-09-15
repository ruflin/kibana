/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { buildManagementPath, resolveManagementLocation } from '../../common/tabs';

describe('resolveManagementLocation', () => {
  it('redirects /streams to data sources', () => {
    expect(resolveManagementLocation('streams')).toEqual({
      tab: 'data_sources',
      needsRedirect: true,
    });
  });

  it('redirects /queries to significant events rules', () => {
    expect(resolveManagementLocation('queries')).toEqual({
      tab: 'significant_events',
      subtab: 'rules',
      needsRedirect: true,
    });
  });

  it('redirects /detections to significant events detections', () => {
    expect(resolveManagementLocation('detections')).toEqual({
      tab: 'significant_events',
      subtab: 'detections',
      needsRedirect: true,
    });
  });

  it('redirects /discoveries to the events list', () => {
    expect(resolveManagementLocation('discoveries')).toEqual({
      tab: 'significant_events',
      needsRedirect: true,
    });
  });

  it('defaults unknown tabs to data sources', () => {
    expect(resolveManagementLocation('not_a_tab')).toEqual({
      tab: 'data_sources',
      needsRedirect: true,
    });
  });

  it('defaults knowledge indicators to topology', () => {
    expect(resolveManagementLocation('knowledge_indicators')).toEqual({
      tab: 'knowledge_indicators',
      subtab: 'topology',
      needsRedirect: true,
    });
  });

  it('keeps a valid knowledge indicators subtab', () => {
    expect(resolveManagementLocation('knowledge_indicators', 'queries')).toEqual({
      tab: 'knowledge_indicators',
      subtab: 'queries',
      needsRedirect: false,
    });
  });

  it('treats /significant_events as the events list', () => {
    expect(resolveManagementLocation('significant_events')).toEqual({
      tab: 'significant_events',
      needsRedirect: false,
    });
  });

  it('canonicalizes /significant_events/events to the events list', () => {
    expect(resolveManagementLocation('significant_events', 'events')).toEqual({
      tab: 'significant_events',
      needsRedirect: true,
    });
  });

  it('keeps rules and detections nested under significant events', () => {
    expect(resolveManagementLocation('significant_events', 'rules')).toEqual({
      tab: 'significant_events',
      subtab: 'rules',
      needsRedirect: false,
    });
    expect(resolveManagementLocation('significant_events', 'detections')).toEqual({
      tab: 'significant_events',
      subtab: 'detections',
      needsRedirect: false,
    });
  });

  it('strips unexpected subtabs from settings', () => {
    expect(resolveManagementLocation('settings', 'extra')).toEqual({
      tab: 'settings',
      needsRedirect: true,
    });
  });
});

describe('buildManagementPath', () => {
  it('builds a flat tab path', () => {
    expect(buildManagementPath({ tab: 'data_sources' })).toBe('/data_sources');
  });

  it('builds a nested tab path', () => {
    expect(buildManagementPath({ tab: 'knowledge_indicators', subtab: 'topology' })).toBe(
      '/knowledge_indicators/topology'
    );
  });
});
