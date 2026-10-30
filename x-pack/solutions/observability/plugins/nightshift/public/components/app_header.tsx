/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import { AppHeader } from '@kbn/app-header';
import type { AppHeaderBack, AppHeaderTab } from '@kbn/app-header';
import type { AppMenuConfig, AppMenuRunActionParams } from '@kbn/core-chrome-app-menu-components';
import { getEbtProps, type EbtClickAttrs } from '@kbn/ebt-click';
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

const investigationsLabel = i18n.translate('xpack.nightshift.investigationsLabel', {
  defaultMessage: 'Investigations',
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

const settingsLabel = i18n.translate('xpack.nightshift.settingsLinkLabel', {
  defaultMessage: 'Settings',
});

const settingsEbtProps = getEbtProps({
  action: NIGHTSHIFT_EBT_ACTIONS.VIEW_SETTINGS,
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

/** Top-level destinations shown as the same tab row on every Nightshift page. */
export type NightshiftTopLevelTabId =
  | 'investigations'
  | 'automations'
  | 'detections'
  | 'knowledge'
  | 'sources';

export type NightshiftAppHeaderPage =
  | 'landing'
  | 'automations'
  | 'detection'
  | 'knowledge'
  | 'settings'
  | 'sources';

const TOP_LEVEL_TAB_IDS: readonly NightshiftTopLevelTabId[] = [
  'investigations',
  'automations',
  'detections',
  'knowledge',
  'sources',
];

const TOP_LEVEL_TAB_PATHS: Record<NightshiftTopLevelTabId, string> = {
  investigations: '/',
  automations: '/automations',
  detections: '/detections/events',
  knowledge: '/knowledge',
  sources: '/sources',
};

const TOP_LEVEL_TAB_LABELS: Record<NightshiftTopLevelTabId, string> = {
  investigations: investigationsLabel,
  automations: automationsLabel,
  detections: detectionsLabel,
  knowledge: KNOWLEDGE_PAGE_TITLE,
  sources: SOURCES_PAGE_TITLE,
};

const TOP_LEVEL_TAB_TEST_SUBJECTS: Record<NightshiftTopLevelTabId, string> = {
  investigations: 'nightshiftInvestigationsTab',
  automations: 'nightshiftAutomationsPrimaryAction',
  detections: 'nightshiftDetectionsPrimaryAction',
  knowledge: 'nightshiftKnowledgeLink',
  sources: 'nightshiftSourcesLink',
};

/** Investigations has no EBT click attributes today, so it is not tracked. */
const TOP_LEVEL_TAB_EBT: Partial<Record<NightshiftTopLevelTabId, EbtClickAttrs>> = {
  automations: {
    action: NIGHTSHIFT_EBT_ACTIONS.VIEW_AUTOMATIONS,
    element: NIGHTSHIFT_EBT_ELEMENTS.PAGE_HEADER,
  },
  detections: {
    action: NIGHTSHIFT_EBT_ACTIONS.VIEW_DETECTIONS,
    element: NIGHTSHIFT_EBT_ELEMENTS.PAGE_HEADER,
  },
  knowledge: {
    action: NIGHTSHIFT_EBT_ACTIONS.VIEW_KNOWLEDGE,
    element: NIGHTSHIFT_EBT_ELEMENTS.PAGE_HEADER,
  },
  sources: {
    action: NIGHTSHIFT_EBT_ACTIONS.VIEW_SOURCES,
    element: NIGHTSHIFT_EBT_ELEMENTS.PAGE_HEADER,
  },
};

/** Onboarding hides these tabs, as it hid the Automations and Detections header actions. */
const TOP_LEVEL_TABS_HIDDEN_WHILE_ONBOARDING: readonly NightshiftTopLevelTabId[] = [
  'automations',
  'detections',
  'sources',
];

export interface NightshiftTopLevelTabsOptions {
  /** The tab for the current page; no tab is selected on Settings. */
  selected?: NightshiftTopLevelTabId;
  canUseAutomations: boolean;
  /** Onboarding hides the tabs listed in TOP_LEVEL_TABS_HIDDEN_WHILE_ONBOARDING, except the selected one. */
  hidesHeaderActions: boolean;
  getHref: (path: string) => string;
  navigate: (path: string) => void;
}

/** Builds the top-level tab row shared by every Nightshift page. */
export const getNightshiftTopLevelTabs = ({
  selected,
  canUseAutomations,
  hidesHeaderActions,
  getHref,
  navigate,
}: NightshiftTopLevelTabsOptions): AppHeaderTab[] =>
  TOP_LEVEL_TAB_IDS.filter((id) => {
    if (id === 'automations' && !canUseAutomations) return false;
    return !(
      hidesHeaderActions &&
      id !== selected &&
      TOP_LEVEL_TABS_HIDDEN_WHILE_ONBOARDING.includes(id)
    );
  }).map((id) => {
    const path = TOP_LEVEL_TAB_PATHS[id];
    const ebt = TOP_LEVEL_TAB_EBT[id];

    return {
      id,
      label: TOP_LEVEL_TAB_LABELS[id],
      isSelected: id === selected,
      href: getHref(path),
      onClick: (event?: React.MouseEvent) => {
        event?.preventDefault();
        navigate(path);
      },
      'data-test-subj': TOP_LEVEL_TAB_TEST_SUBJECTS[id],
      ...(ebt && getEbtProps(ebt)),
    };
  });

export interface NightshiftAppHeaderProps {
  page?: NightshiftAppHeaderPage;
  topLevelTabs?: AppHeaderTab[];
  onSettingsClick?: () => void | Promise<void>;
  settingsHref?: string;
  back?: AppHeaderBack;
}

/** The header props every top-level page receives, so the header is the same everywhere. */
export type NightshiftHeaderNavigation = Pick<
  NightshiftAppHeaderProps,
  'topLevelTabs' | 'onSettingsClick' | 'settingsHref'
>;

export function NightshiftAppHeader({
  page = 'landing',
  topLevelTabs,
  onSettingsClick,
  settingsHref,
  back,
}: NightshiftAppHeaderProps): React.ReactElement {
  const menu = useMemo<AppMenuConfig>(
    () => ({
      // Settings is the only header action, in the same place on every page.
      items:
        onSettingsClick && settingsHref
          ? [
              {
                id: 'nightshiftSettings',
                label: settingsLabel,
                iconType: 'gear' as const,
                href: settingsHref,
                run: (params?: AppMenuRunActionParams) => {
                  applyEbtProps(settingsEbtProps, params);
                  void onSettingsClick();
                },
                testId: 'nightshiftSettingsLink',
              },
            ]
          : [],
    }),
    [onSettingsClick, settingsHref]
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
      tabs={topLevelTabs}
      menu={menu}
      spacing="compact"
    />
  );
}
