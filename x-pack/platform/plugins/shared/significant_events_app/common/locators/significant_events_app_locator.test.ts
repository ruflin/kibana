/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SignificantEventsAppLocatorDefinition } from './significant_events_app_locator';

describe('SignificantEventsAppLocatorDefinition', () => {
  const locator = new SignificantEventsAppLocatorDefinition();

  it('defaults to the data sources tab with no query params', async () => {
    const location = await locator.getLocation({});

    expect(location).toEqual({
      app: 'significantEvents',
      path: '/data_sources',
      state: {},
    });
  });

  it('maps the legacy streams tab to data sources', async () => {
    const { path } = await locator.getLocation({ tab: 'streams' });

    expect(path).toBe('/data_sources');
  });

  it('builds a path for a specific tab', async () => {
    const { path } = await locator.getLocation({ tab: 'settings' });

    expect(path).toBe('/settings');
  });

  it('defaults knowledge indicators to the topology subtab', async () => {
    const { path } = await locator.getLocation({ tab: 'knowledge_indicators' });

    expect(path).toBe('/knowledge_indicators/topology');
  });

  it('builds a nested knowledge indicators path', async () => {
    const { path } = await locator.getLocation({
      tab: 'knowledge_indicators',
      subtab: 'queries',
    });

    expect(path).toBe('/knowledge_indicators/queries');
  });

  it('maps the legacy queries tab to significant events rules', async () => {
    const { path } = await locator.getLocation({ tab: 'queries' });

    expect(path).toBe('/significant_events/rules');
  });

  it('maps the legacy detections tab to significant events detections', async () => {
    const { path } = await locator.getLocation({ tab: 'detections' });

    expect(path).toBe('/significant_events/detections');
  });

  it('serializes scalar query params', async () => {
    const { path } = await locator.getLocation({
      tab: 'significant_events',
      rangeFrom: 'now-24h',
      rangeTo: 'now',
      selectedEvent: 'event-1',
    });

    expect(path).toBe('/significant_events?rangeFrom=now-24h&rangeTo=now&selectedEvent=event-1');
  });

  it('serializes array query params as repeated keys', async () => {
    const { path } = await locator.getLocation({
      tab: 'knowledge_indicators',
      stream: ['logs', 'logs.nginx'],
    });

    expect(path).toBe(
      '/knowledge_indicators/topology?stream=logs&stream=logs.nginx'
    );
  });

  it('omits undefined params', async () => {
    const { path } = await locator.getLocation({
      tab: 'significant_events',
      subtab: 'rules',
      search: undefined,
    });

    expect(path).toBe('/significant_events/rules');
  });
});
