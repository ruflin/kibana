/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AppMenuItemType } from '@kbn/core-chrome-app-menu-components';
import { getNightshiftMenuItems, type NightshiftNavItems } from './app_header';

const navItem = (href: string) => ({ href, onClick: jest.fn() });

const allNavItems: NightshiftNavItems = {
  automations: navItem('/app/nightshift/automations'),
  detections: navItem('/app/nightshift/detections/events'),
  knowledge: navItem('/app/nightshift/knowledge'),
  sources: navItem('/app/nightshift/sources'),
  settings: navItem('/app/nightshift/settings'),
};

const getIds = (items: AppMenuItemType[]) => items.map(({ id }) => id);
const getSelectedIds = (items: AppMenuItemType[]) =>
  items.filter((item) => item.isSelected).map(({ id }) => id);

describe('getNightshiftMenuItems', () => {
  it('lists the items in one order: Automations, Detections, Knowledge, Sources, Settings', () => {
    const items = getNightshiftMenuItems(allNavItems, 'landing');

    expect(getIds(items)).toEqual([
      'nightshiftAutomations',
      'nightshiftDetections',
      'nightshiftKnowledge',
      'nightshiftSources',
      'nightshiftSettings',
    ]);
  });

  it('keeps the same order on a page that is not the landing page', () => {
    expect(getIds(getNightshiftMenuItems(allNavItems, 'sources'))).toEqual(
      getIds(getNightshiftMenuItems(allNavItems, 'landing'))
    );
  });

  it('places Automations and Detections inline and moves the others to the overflow menu', () => {
    const items = getNightshiftMenuItems(allNavItems, 'detection');
    const overflowById = Object.fromEntries(items.map((item) => [item.id, item.overflow]));

    expect(overflowById).toEqual({
      nightshiftAutomations: false,
      nightshiftDetections: false,
      nightshiftKnowledge: true,
      nightshiftSources: true,
      nightshiftSettings: true,
    });
  });

  it.each([
    ['automations', 'nightshiftAutomations'],
    ['detection', 'nightshiftDetections'],
    ['knowledge', 'nightshiftKnowledge'],
    ['sources', 'nightshiftSources'],
    ['settings', 'nightshiftSettings'],
  ] as const)('marks only the %s page item as selected', (page, selectedId) => {
    const items = getNightshiftMenuItems(allNavItems, page);

    expect(getSelectedIds(items)).toEqual([selectedId]);
  });

  it('marks no item as selected on the landing page', () => {
    expect(getSelectedIds(getNightshiftMenuItems(allNavItems, 'landing'))).toEqual([]);
  });

  it('omits an item that has no nav entry, and keeps the others in order', () => {
    const { automations, ...withoutAutomations } = allNavItems;
    void automations;

    expect(getIds(getNightshiftMenuItems(withoutAutomations, 'landing'))).toEqual([
      'nightshiftDetections',
      'nightshiftKnowledge',
      'nightshiftSources',
      'nightshiftSettings',
    ]);
  });

  it('returns no items when no nav entry is provided', () => {
    expect(getNightshiftMenuItems({}, 'settings')).toEqual([]);
  });

  it('links each item to its href and runs its onClick', () => {
    const items = getNightshiftMenuItems(allNavItems, 'landing');
    const settings = items.find(({ id }) => id === 'nightshiftSettings');

    expect(settings).toMatchObject({
      href: '/app/nightshift/settings',
      testId: 'nightshiftSettingsLink',
    });

    settings?.run?.();
    expect(allNavItems.settings?.onClick).toHaveBeenCalledTimes(1);
  });

  it('sets the EBT attributes on the trigger element when an item runs', () => {
    const items = getNightshiftMenuItems(allNavItems, 'landing');
    const knowledge = items.find(({ id }) => id === 'nightshiftKnowledge');
    const triggerElement = document.createElement('a');

    knowledge?.run?.({ triggerElement, returnFocus: jest.fn() });

    expect(triggerElement.getAttribute('data-ebt-action')).toBe('viewKnowledge');
    expect(triggerElement.getAttribute('data-ebt-element')).toBe('nightshiftPageHeader');
  });
});
