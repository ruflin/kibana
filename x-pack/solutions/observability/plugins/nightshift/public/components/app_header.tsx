/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { AppHeader } from '@kbn/app-header';
import type { AppHeaderTab } from '@kbn/app-header';
import { i18n } from '@kbn/i18n';

const nightshiftPageTitle = i18n.translate('xpack.nightshift.pageTitle', {
  defaultMessage: 'Nightshift',
});

const automationsLabel = i18n.translate('xpack.nightshift.automationsLabel', {
  defaultMessage: 'Automations',
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

/**
 * Pages are reached from the Kibana left nav, so the header only carries the page title and,
 * where a page has them, its sub-tabs.
 */
export interface NightshiftAppHeaderProps {
  page?: 'landing' | 'automations' | 'detection' | 'knowledge' | 'settings' | 'sources';
  tabs?: AppHeaderTab[];
}

export function NightshiftAppHeader({
  page = 'landing',
  tabs,
}: NightshiftAppHeaderProps): React.ReactElement {
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
      tabs={tabs}
      spacing="compact"
    />
  );
}
