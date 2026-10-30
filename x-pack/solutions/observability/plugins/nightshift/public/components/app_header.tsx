/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import { AppHeader } from '@kbn/app-header';
import type { AppHeaderBack, AppHeaderTab } from '@kbn/app-header';
import type {
  AppMenuConfig,
  AppMenuItemType,
  AppMenuRunActionParams,
} from '@kbn/core-chrome-app-menu-components';
import { getEbtProps } from '@kbn/ebt-click';
import { i18n } from '@kbn/i18n';
import { NIGHTSHIFT_EBT_ACTIONS, NIGHTSHIFT_EBT_ELEMENTS } from '../common/ebt_constants';

const nightshiftPageTitle = i18n.translate('xpack.nightshift.pageTitle', {
  defaultMessage: 'Nightshift',
});

const automationsLabel = i18n.translate('xpack.nightshift.automationsLabel', {
  defaultMessage: 'Automations',
});

const detectionsLabel = i18n.translate('xpack.nightshift.detectionsLabel', {
  defaultMessage: 'Detections',
});

export const SETTINGS_PAGE_TITLE = i18n.translate('xpack.nightshift.settingsPage.title', {
  defaultMessage: 'Settings',
});

export const KNOWLEDGE_PAGE_TITLE = i18n.translate('xpack.nightshift.knowledgePage.title', {
  defaultMessage: 'Knowledge',
});

export const SOURCES_PAGE_TITLE = i18n.translate('xpack.nightshift.sourcesPage.title', {
  defaultMessage: 'Sources',
});

export const DETECTION_PAGE_TITLE = i18n.translate('xpack.nightshift.detectionPage.title', {
  defaultMessage: 'Detections',
});

const sourcesLabel = i18n.translate('xpack.nightshift.sourcesLinkLabel', {
  defaultMessage: 'Sources',
});

const settingsLabel = i18n.translate('xpack.nightshift.settingsLinkLabel', {
  defaultMessage: 'Settings',
});

const knowledgeLabel = i18n.translate('xpack.nightshift.knowledgeLinkLabel', {
  defaultMessage: 'Knowledge',
});

const settingsEbtProps = getEbtProps({
  action: NIGHTSHIFT_EBT_ACTIONS.VIEW_SETTINGS,
  element: NIGHTSHIFT_EBT_ELEMENTS.PAGE_HEADER,
});

const knowledgeEbtProps = getEbtProps({
  action: NIGHTSHIFT_EBT_ACTIONS.VIEW_KNOWLEDGE,
  element: NIGHTSHIFT_EBT_ELEMENTS.PAGE_HEADER,
});

const sourcesEbtProps = getEbtProps({
  action: NIGHTSHIFT_EBT_ACTIONS.VIEW_SOURCES,
  element: NIGHTSHIFT_EBT_ELEMENTS.PAGE_HEADER,
});

const automationsEbtProps = getEbtProps({
  action: NIGHTSHIFT_EBT_ACTIONS.VIEW_AUTOMATIONS,
  element: NIGHTSHIFT_EBT_ELEMENTS.PAGE_HEADER,
});

const detectionsEbtProps = getEbtProps({
  action: NIGHTSHIFT_EBT_ACTIONS.VIEW_DETECTIONS,
  element: NIGHTSHIFT_EBT_ELEMENTS.PAGE_HEADER,
});

const applyEbtProps = (
  ebtProps: typeof settingsEbtProps,
  params?: AppMenuRunActionParams
): void => {
  if (!params) {
    return;
  }

  Object.entries(ebtProps).forEach(([attribute, value]) => {
    params.triggerElement.setAttribute(attribute, value);
  });
};

/** A top-level Nightshift destination shown in the header menu. */
export interface NightshiftNavItem {
  href: string;
  onClick: () => void | Promise<void>;
}

/** Top-level destinations. An omitted entry is hidden on every page. */
export interface NightshiftNavItems {
  automations?: NightshiftNavItem;
  detections?: NightshiftNavItem;
  knowledge?: NightshiftNavItem;
  sources?: NightshiftNavItem;
  settings?: NightshiftNavItem;
}

export type NightshiftHeaderPage =
  | 'landing'
  | 'automations'
  | 'detection'
  | 'knowledge'
  | 'settings'
  | 'sources';

/** Header props every top-level Nightshift page receives, so the menu is the same on each. */
export interface NightshiftNavHeaderProps {
  navItems?: NightshiftNavItems;
}

export interface NightshiftAppHeaderProps extends NightshiftNavHeaderProps {
  page?: NightshiftHeaderPage;
  tabs?: AppHeaderTab[];
  back?: AppHeaderBack;
}

type NightshiftNavKey = keyof NightshiftNavItems;

interface NightshiftNavDefinition {
  id: string;
  label: string;
  iconType: 'workflow' | 'visGauge' | 'documentation' | 'database' | 'gear';
  testId: string;
  ebtProps: typeof settingsEbtProps;
  /** Moved into the "More" menu. Without it the menu picks its own split by item count. */
  overflow: boolean;
}

/** Label, icon, test id, EBT attributes and placement of each menu item. Order is `NIGHTSHIFT_NAV_ORDER`. */
const NIGHTSHIFT_NAV_DEFINITIONS: Record<NightshiftNavKey, NightshiftNavDefinition> = {
  automations: {
    id: 'nightshiftAutomations',
    label: automationsLabel,
    iconType: 'workflow',
    testId: 'nightshiftAutomationsPrimaryAction',
    ebtProps: automationsEbtProps,
    overflow: false,
  },
  detections: {
    id: 'nightshiftDetections',
    label: detectionsLabel,
    iconType: 'visGauge',
    testId: 'nightshiftDetectionsPrimaryAction',
    ebtProps: detectionsEbtProps,
    overflow: false,
  },
  knowledge: {
    id: 'nightshiftKnowledge',
    label: knowledgeLabel,
    iconType: 'documentation',
    testId: 'nightshiftKnowledgeLink',
    ebtProps: knowledgeEbtProps,
    overflow: true,
  },
  sources: {
    id: 'nightshiftSources',
    label: sourcesLabel,
    iconType: 'database',
    testId: 'nightshiftSourcesLink',
    ebtProps: sourcesEbtProps,
    overflow: true,
  },
  settings: {
    id: 'nightshiftSettings',
    label: settingsLabel,
    iconType: 'gear',
    testId: 'nightshiftSettingsLink',
    ebtProps: settingsEbtProps,
    overflow: true,
  },
};

const NIGHTSHIFT_NAV_ORDER: readonly NightshiftNavKey[] = [
  'automations',
  'detections',
  'knowledge',
  'sources',
  'settings',
];

/** The menu item that represents each page. The landing page has none. */
const PAGE_NAV_KEY: Partial<Record<NightshiftHeaderPage, NightshiftNavKey>> = {
  automations: 'automations',
  detection: 'detections',
  knowledge: 'knowledge',
  sources: 'sources',
  settings: 'settings',
};

/** Builds the header menu for a page. Items keep one order and placement on every page. */
export const getNightshiftMenuItems = (
  navItems: NightshiftNavItems,
  page: NightshiftHeaderPage
): AppMenuItemType[] => {
  const selectedKey = PAGE_NAV_KEY[page];

  return NIGHTSHIFT_NAV_ORDER.flatMap((key): AppMenuItemType[] => {
    const navItem = navItems[key];
    if (!navItem) {
      return [];
    }

    const { id, label, iconType, testId, ebtProps, overflow } = NIGHTSHIFT_NAV_DEFINITIONS[key];

    return [
      {
        id,
        label,
        iconType,
        href: navItem.href,
        testId,
        overflow,
        isSelected: key === selectedKey,
        run: (params?: AppMenuRunActionParams) => {
          applyEbtProps(ebtProps, params);
          void navItem.onClick();
        },
      },
    ];
  });
};

const NO_NAV_ITEMS: NightshiftNavItems = {};

export function NightshiftAppHeader({
  page = 'landing',
  navItems = NO_NAV_ITEMS,
  tabs,
  back,
}: NightshiftAppHeaderProps): React.ReactElement {
  const menu = useMemo<AppMenuConfig>(
    () => ({ items: getNightshiftMenuItems(navItems, page) }),
    [navItems, page]
  );

  return (
    <AppHeader
      title={
        page === 'automations'
          ? automationsLabel
          : page === 'detection'
          ? DETECTION_PAGE_TITLE
          : page === 'knowledge'
          ? KNOWLEDGE_PAGE_TITLE
          : page === 'settings'
          ? SETTINGS_PAGE_TITLE
          : page === 'sources'
          ? SOURCES_PAGE_TITLE
          : nightshiftPageTitle
      }
      back={back}
      tabs={tabs}
      menu={menu}
      spacing="compact"
    />
  );
}
