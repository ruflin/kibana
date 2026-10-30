/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { EuiPageTemplate, EuiSpacer, EuiTab, EuiTabs } from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { getNightshiftCapabilities } from '@kbn/nightshift-shared';
import { reactRouterNavigate } from '@kbn/kibana-react-plugin/public';
import { Redirect, useHistory, useParams } from 'react-router-dom';
import { NightshiftAppHeader } from '../components/app_header';
import type { NightshiftHeaderNavigation } from '../components/app_header';
import { useKibana } from '../hooks/use_kibana';
import { DetectionsSettingsTab } from './detections_settings_tab';
import { GeneralSettingsTab } from './general_settings_tab';
import { useAppsEnabled } from './hooks/use_apps_enabled';
import { InvestigationsSettingsTab } from './investigations_settings_tab';
import {
  getDefaultSettingsTab,
  getVisibleSettingsTabs,
  isSettingsTabId,
  type SettingsTabId,
} from './settings_tabs';

const settingsTabLabels: Record<SettingsTabId, string> = {
  general: i18n.translate('xpack.nightshift.settingsPage.tabs.general', {
    defaultMessage: 'General',
  }),
  investigations: i18n.translate('xpack.nightshift.settingsPage.tabs.investigations', {
    defaultMessage: 'Investigations',
  }),
  detections: i18n.translate('xpack.nightshift.settingsPage.tabs.detections', {
    defaultMessage: 'Detections',
  }),
};

type SettingsPageHeaderProps = NightshiftHeaderNavigation & {
  onCustomContextClick?: () => void;
};

export function SettingsPage({ headerProps }: { headerProps: SettingsPageHeaderProps }) {
  const { onCustomContextClick, ...navigation } = headerProps;
  const { application } = useKibana().services;
  const { tab } = useParams<{ tab?: string }>();
  const history = useHistory();
  const isAppsEnabled = useAppsEnabled();
  const { canManage } = getNightshiftCapabilities(application.capabilities.nightshift);

  if (isAppsEnabled === undefined) {
    return null;
  }

  const visibleTabs = getVisibleSettingsTabs({ isAppsEnabled });

  if (!tab || !isSettingsTabId(tab) || !visibleTabs.includes(tab)) {
    return <Redirect to={`/settings/${getDefaultSettingsTab(visibleTabs)}`} />;
  }

  return (
    <>
      <NightshiftAppHeader {...navigation} page="settings" />
      <EuiPageTemplate.Section component="div" restrictWidth={false}>
        <EuiTabs size="s">
          {visibleTabs.map((id) => (
            <EuiTab
              key={id}
              isSelected={tab === id}
              {...reactRouterNavigate(history, `/settings/${id}`)}
              data-test-subj={`nightshiftSettingsTab-${id}`}
            >
              {settingsTabLabels[id]}
            </EuiTab>
          ))}
        </EuiTabs>
        <EuiSpacer size="m" />
        {tab === 'general' && <GeneralSettingsTab />}
        {tab === 'investigations' && (
          <InvestigationsSettingsTab
            onCustomContextClick={onCustomContextClick}
            canEditCustomContext={canManage}
          />
        )}
        {tab === 'detections' && <DetectionsSettingsTab />}
      </EuiPageTemplate.Section>
    </>
  );
}
