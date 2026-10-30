/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getNightshiftTopLevelTabs, type NightshiftTopLevelTabsOptions } from './app_header';

const getHref = (path: string) => `/app/nightshift${path}`;

const getOptions = (
  overrides: Partial<NightshiftTopLevelTabsOptions> = {}
): NightshiftTopLevelTabsOptions => ({
  canUseAutomations: true,
  hidesHeaderActions: false,
  getHref,
  navigate: jest.fn(),
  ...overrides,
});

const getIds = (options: NightshiftTopLevelTabsOptions) =>
  getNightshiftTopLevelTabs(options).map(({ id }) => id);

describe('getNightshiftTopLevelTabs', () => {
  it('lists Investigations, Automations, Detections, Knowledge and Sources in order', () => {
    expect(getIds(getOptions())).toEqual([
      'investigations',
      'automations',
      'detections',
      'knowledge',
      'sources',
    ]);
  });

  it('leaves out Automations without the automations API', () => {
    expect(getIds(getOptions({ canUseAutomations: false }))).toEqual([
      'investigations',
      'detections',
      'knowledge',
      'sources',
    ]);
  });

  it('hides Automations, Detections and Sources while onboarding, but keeps Knowledge', () => {
    expect(getIds(getOptions({ hidesHeaderActions: true }))).toEqual([
      'investigations',
      'knowledge',
    ]);
  });

  it('keeps the selected tab visible while onboarding', () => {
    expect(getIds(getOptions({ hidesHeaderActions: true, selected: 'detections' }))).toEqual([
      'investigations',
      'detections',
      'knowledge',
    ]);
  });

  it('selects only the tab for the current page', () => {
    const tabs = getNightshiftTopLevelTabs(getOptions({ selected: 'knowledge' }));

    expect(tabs.filter(({ isSelected }) => isSelected).map(({ id }) => id)).toEqual(['knowledge']);
  });

  it('selects no tab on Settings', () => {
    const tabs = getNightshiftTopLevelTabs(getOptions({ selected: undefined }));

    expect(tabs.some(({ isSelected }) => isSelected)).toBe(false);
  });

  it('links each tab to its page path', () => {
    const hrefs = Object.fromEntries(
      getNightshiftTopLevelTabs(getOptions()).map(({ id, href }) => [id, href])
    );

    expect(hrefs).toEqual({
      investigations: '/app/nightshift/',
      automations: '/app/nightshift/automations',
      detections: '/app/nightshift/detections/events',
      knowledge: '/app/nightshift/knowledge',
      sources: '/app/nightshift/sources',
    });
  });

  it('navigates in app and prevents the default link navigation on click', () => {
    const navigate = jest.fn();
    const tabs = getNightshiftTopLevelTabs(getOptions({ navigate }));
    const sources = tabs.find(({ id }) => id === 'sources');
    // The header passes the click event to onClick at runtime, though the type declares no argument.
    const onClick = sources?.onClick as
      | ((event: { preventDefault: () => void }) => void)
      | undefined;
    const preventDefault = jest.fn();

    onClick?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/sources');
  });

  it('keeps the existing EBT attributes on the tabs that had them', () => {
    const tabs = Object.fromEntries(
      getNightshiftTopLevelTabs(getOptions()).map((tab) => [tab.id, tab])
    );

    expect(tabs.automations).toMatchObject({
      'data-ebt-action': 'viewAutomations',
      'data-ebt-element': 'nightshiftPageHeader',
    });
    expect(tabs.detections).toMatchObject({
      'data-ebt-action': 'viewDetections',
      'data-ebt-element': 'nightshiftPageHeader',
    });
    expect(tabs.knowledge).toMatchObject({
      'data-ebt-action': 'viewKnowledge',
      'data-ebt-element': 'nightshiftPageHeader',
    });
    expect(tabs.sources).toMatchObject({
      'data-ebt-action': 'viewSources',
      'data-ebt-element': 'nightshiftPageHeader',
    });
    expect(tabs.investigations).not.toHaveProperty('data-ebt-action');
  });

  it('keeps the existing test subjects of the tabs', () => {
    const testSubjects = Object.fromEntries(
      getNightshiftTopLevelTabs(getOptions()).map((tab) => [tab.id, tab['data-test-subj']])
    );

    expect(testSubjects).toEqual({
      investigations: 'nightshiftInvestigationsTab',
      automations: 'nightshiftAutomationsPrimaryAction',
      detections: 'nightshiftDetectionsPrimaryAction',
      knowledge: 'nightshiftKnowledgeLink',
      sources: 'nightshiftSourcesLink',
    });
  });
});
