/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiButton, EuiCallOut, EuiLoadingElastic, EuiSpacer } from '@elastic/eui';
import type { AppHeaderMenu } from '@kbn/app-header';
import { NIGHTSHIFT_APP_ID } from '@kbn/deeplinks-observability';
import { i18n } from '@kbn/i18n';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useKibana } from '../../hooks/use_kibana';
import { getFormattedError } from '../../util/errors';
import { useManagementRoute } from '../../hooks/use_management_route';
import { useSignificantEventsAvailability } from '../../hooks/use_significant_events_availability';
import { useBlocksNewActivity } from '../../hooks/use_significant_events_maintenance';
import { RedirectTo } from '../../components/redirect_to';
import { SignificantEventsNotEnabledPrompt } from '../../components/not_enabled_prompt';
import {
  SignificantEventsAppHeader,
  SignificantEventsAppPageTemplate,
} from '../../components/page_template';
import {
  KnowledgeIndicatorsTable,
  KiGenerationProvider,
} from './components/knowledge_indicators_table';
import { SignificantEventsPageProvider } from './context/significant_events_page_context';
import { ONBOARDING_FAILURE_TITLE } from './components/streams_view/translations';
import { QueriesTable } from './components/queries_table/queries_table';
import { StreamsView } from './components/streams_view/streams_view';
import { SettingsTab } from './components/settings/tab';
import { MemoryTab } from './components/memory/tab';
import { DetectionsTab } from './components/detections_tab';
import { SignificantEventsTab } from './components/significant_events_tab';
import { RunLimitsBanner } from './components/run_limits_banner';
import { ManagementSubTabs } from './components/management_sub_tabs';
import type { KnowledgeIndicatorView } from '../../components/knowledge_indicators/utils/get_knowledge_indicator_view';
import {
  isKiSubtab,
  resolveManagementLocation,
} from '../../routes/tabs';

export function SignificantEventsPage() {
  const { tab, subtab, link } = useManagementRoute();
  const {
    core: {
      application: {
        getUrlForApp,
        capabilities: { streams },
      },
      chrome,
      notifications: { toasts },
    },
    dependencies: {
      start: { agentBuilder },
    },
  } = useKibana();

  const canManageStreams = streams?.manage === true;

  const { availability, isLoading: isAvailabilityLoading } = useSignificantEventsAvailability();
  const {
    isBlocked,
    isLoading: isMaintenanceStatusLoading,
    isError: isMaintenanceStatusError,
    status: maintenanceStatus,
  } = useBlocksNewActivity();
  const isSettingsPage = tab === 'settings';
  const showMaintenanceBanners = !isSettingsPage;
  const canonical = resolveManagementLocation(tab, subtab);

  const onOnboardingFailed = useCallback(
    (error: string) => {
      toasts.addError(getFormattedError(new Error(error)), {
        title: ONBOARDING_FAILURE_TITLE,
      });
    },
    [toasts]
  );

  const pageTitle = i18n.translate('xpack.significantEventsApp.pageHeaderTitle', {
    defaultMessage: 'Nightshift Management',
  });

  const nightshiftLabel = i18n.translate('xpack.significantEventsApp.nightshiftButtonLabel', {
    defaultMessage: 'Nightshift',
  });

  const settingsLabel = i18n.translate('xpack.significantEventsApp.settingsButtonLabel', {
    defaultMessage: 'Settings',
  });

  const managementLabel = i18n.translate('xpack.significantEventsApp.managementButtonLabel', {
    defaultMessage: 'Management',
  });

  const systemOnboardingLabel = i18n.translate(
    'xpack.significantEventsApp.systemOnboardingButton',
    { defaultMessage: 'Tell us about your system' }
  );

  const handleOpenSystemOnboarding = useCallback(() => {
    agentBuilder?.openChat({
      newConversation: true,
      initialMessage: i18n.translate('xpack.significantEventsApp.onboardingInitialMessage', {
        defaultMessage:
          'Start the significant-events-onboarding skill. First check whether there is already memory about my system. If there is, summarise what you know and ask whether I have something specific to add or correct, or whether I want a general review of the gaps. If memory is empty, go straight into gathering information.',
      }),
      autoSendInitialMessage: true,
    });
  }, [agentBuilder]);

  const menu = useMemo<AppHeaderMenu>(() => {
    const items: NonNullable<AppHeaderMenu['items']> = [
      {
        id: 'nightshift',
        order: 1,
        label: nightshiftLabel,
        iconType: 'moon',
        href: getUrlForApp(NIGHTSHIFT_APP_ID),
      },
    ];

    if (isSettingsPage) {
      items.push({
        id: 'management',
        order: 2,
        label: managementLabel,
        iconType: 'layers',
        href: link({ tab: 'significant_events' }),
        testId: 'significantEventsManagementLink',
      });
    } else {
      items.push({
        id: 'settings',
        order: 2,
        label: settingsLabel,
        iconType: 'gear',
        href: link({ tab: 'settings' }),
        testId: 'significantEventsSettingsLink',
      });
    }

    if (agentBuilder) {
      items.push({
        id: 'significantEventsSystemOnboarding',
        order: 3,
        label: systemOnboardingLabel,
        iconType: 'sparkles',
        run: handleOpenSystemOnboarding,
        testId: 'significantEventsSystemOnboardingButton',
      });
    }

    return { items };
  }, [
    agentBuilder,
    getUrlForApp,
    handleOpenSystemOnboarding,
    isSettingsPage,
    link,
    managementLabel,
    nightshiftLabel,
    settingsLabel,
    systemOnboardingLabel,
  ]);

  useEffect(() => {
    chrome.setBreadcrumbs([
      {
        text: i18n.translate('xpack.significantEventsApp.breadcrumb', {
          defaultMessage: 'Nightshift Management',
        }),
      },
    ]);
  }, [chrome]);

  const tabs = useMemo(
    () => [
      {
        id: 'data_sources',
        label: i18n.translate('xpack.significantEventsApp.dataSourcesTab', {
          defaultMessage: 'Data Sources',
        }),
        href: link({ tab: 'data_sources' }),
        isSelected: canonical.tab === 'data_sources',
      },
      {
        id: 'knowledge_indicators',
        label: i18n.translate('xpack.significantEventsApp.knowledgeIndicatorsTab', {
          defaultMessage: 'Knowledge Indicators',
        }),
        href: link({ tab: 'knowledge_indicators', subtab: 'topology' }),
        isSelected: canonical.tab === 'knowledge_indicators',
      },
      {
        id: 'significant_events',
        label: i18n.translate('xpack.significantEventsApp.significantEventsTab', {
          defaultMessage: 'Significant Events',
        }),
        href: link({ tab: 'significant_events' }),
        isSelected: canonical.tab === 'significant_events',
      },
      {
        id: 'memory',
        label: i18n.translate('xpack.significantEventsApp.memoryTab', {
          defaultMessage: 'Memory',
        }),
        href: link({ tab: 'memory' }),
        isSelected: canonical.tab === 'memory',
      },
    ],
    [canonical.tab, link]
  );

  const kiSubtabs = useMemo(
    () => [
      {
        id: 'topology',
        label: i18n.translate('xpack.significantEventsApp.knowledgeIndicatorsTopologySubtab', {
          defaultMessage: 'Topology',
        }),
        href: link({ tab: 'knowledge_indicators', subtab: 'topology' }),
        isSelected: canonical.subtab === 'topology',
      },
      {
        id: 'queries',
        label: i18n.translate('xpack.significantEventsApp.knowledgeIndicatorsQueriesSubtab', {
          defaultMessage: 'Queries',
        }),
        href: link({ tab: 'knowledge_indicators', subtab: 'queries' }),
        isSelected: canonical.subtab === 'queries',
      },
      {
        id: 'more',
        label: i18n.translate('xpack.significantEventsApp.knowledgeIndicatorsMoreSubtab', {
          defaultMessage: 'More',
        }),
        href: link({ tab: 'knowledge_indicators', subtab: 'more' }),
        isSelected: canonical.subtab === 'more',
      },
    ],
    [canonical.subtab, link]
  );

  const significantEventsSubtabs = useMemo(
    () => [
      {
        id: 'events',
        label: i18n.translate('xpack.significantEventsApp.significantEventsEventsSubtab', {
          defaultMessage: 'Events',
        }),
        href: link({ tab: 'significant_events' }),
        isSelected: canonical.tab === 'significant_events' && canonical.subtab === undefined,
      },
      {
        id: 'rules',
        label: i18n.translate('xpack.significantEventsApp.significantEventsRulesSubtab', {
          defaultMessage: 'Rules',
        }),
        href: link({ tab: 'significant_events', subtab: 'rules' }),
        isSelected: canonical.subtab === 'rules',
      },
      {
        id: 'detections',
        label: i18n.translate('xpack.significantEventsApp.significantEventsDetectionsSubtab', {
          defaultMessage: 'Detections',
        }),
        href: link({ tab: 'significant_events', subtab: 'detections' }),
        isSelected: canonical.subtab === 'detections',
      },
    ],
    [canonical.subtab, canonical.tab, link]
  );

  if (isAvailabilityLoading) {
    return <EuiLoadingElastic size="xxl" />;
  }

  if (!availability || !availability.available) {
    const reason =
      availability && !availability.available ? availability.reason : ('unknown' as const);
    return (
      <SignificantEventsAppPageTemplate.Body grow>
        <SignificantEventsNotEnabledPrompt reason={reason} />
      </SignificantEventsAppPageTemplate.Body>
    );
  }

  if (canonical.needsRedirect) {
    if (canonical.subtab) {
      return (
        <RedirectTo
          path="/{tab}/{subtab}"
          params={{ path: { tab: canonical.tab, subtab: canonical.subtab } }}
        />
      );
    }
    return <RedirectTo path="/{tab}" params={{ path: { tab: canonical.tab } }} />;
  }

  const kiView: KnowledgeIndicatorView | undefined =
    canonical.subtab && isKiSubtab(canonical.subtab) ? canonical.subtab : undefined;

  return (
    <>
      <SignificantEventsAppHeader
        title={pageTitle}
        menu={menu}
        tabs={isSettingsPage ? undefined : tabs}
      />
      <KiGenerationProvider onFailed={onOnboardingFailed}>
        <SignificantEventsPageProvider>
          <SignificantEventsAppPageTemplate.Body grow>
            {showMaintenanceBanners && isMaintenanceStatusLoading && (
              <>
                <EuiCallOut
                  announceOnMount
                  color="primary"
                  iconType="clock"
                  data-test-subj="significantEventsStatusLoadingBanner"
                  title={i18n.translate('xpack.significantEventsApp.statusLoadingBannerTitle', {
                    defaultMessage: 'Checking Significant Events activity status',
                  })}
                >
                  <p>
                    {i18n.translate('xpack.significantEventsApp.statusLoadingBannerBody', {
                      defaultMessage:
                        'Manual triggers stay disabled until activity status is known.',
                    })}
                  </p>
                </EuiCallOut>
                <EuiSpacer />
              </>
            )}
            {showMaintenanceBanners && isMaintenanceStatusError && (
              <>
                <EuiCallOut
                  announceOnMount
                  color="danger"
                  iconType="error"
                  data-test-subj="significantEventsStatusErrorBanner"
                  title={i18n.translate('xpack.significantEventsApp.statusErrorBannerTitle', {
                    defaultMessage: 'Could not load Significant Events activity status',
                  })}
                >
                  <p>
                    {i18n.translate('xpack.significantEventsApp.statusErrorBannerBody', {
                      defaultMessage:
                        'Manual triggers stay disabled until status can be loaded. Open Settings to retry, or refresh the page.',
                    })}
                  </p>
                  {canManageStreams && (
                    <EuiButton
                      href={link({ tab: 'settings' })}
                      color="danger"
                      size="s"
                      data-test-subj="significantEventsStatusErrorBannerSettingsLink"
                    >
                      {i18n.translate(
                        'xpack.significantEventsApp.statusErrorBannerSettingsButton',
                        { defaultMessage: 'Go to Settings' }
                      )}
                    </EuiButton>
                  )}
                </EuiCallOut>
                <EuiSpacer />
              </>
            )}
            {showMaintenanceBanners && isBlocked && (
              <>
                <EuiCallOut
                  announceOnMount
                  color="warning"
                  iconType="pause"
                  data-test-subj="significantEventsPausedBanner"
                  title={i18n.translate('xpack.significantEventsApp.pausedBannerTitle', {
                    defaultMessage: 'Significant Events activity is paused',
                  })}
                >
                  <p>
                    {canManageStreams
                      ? i18n.translate('xpack.significantEventsApp.pausedBannerBody', {
                          defaultMessage:
                            'Significant Events activity is stopped across the deployment: scheduled discovery, continuous onboarding, detections, memory, investigations, and the alerting rules backing knowledge indicator queries. Manual triggers are blocked until you resume from Settings.',
                        })
                      : i18n.translate('xpack.significantEventsApp.pausedBannerBodyReadOnly', {
                          defaultMessage:
                            'Significant Events activity is stopped across the deployment: scheduled discovery, continuous onboarding, detections, memory, investigations, and the alerting rules backing knowledge indicator queries. Manual triggers are blocked. An administrator with the Streams manage privilege must resume activity from Settings.',
                        })}
                  </p>
                  {(maintenanceStatus?.lastSummary?.partialFailures.length ?? 0) > 0 && (
                    <p>
                      {i18n.translate('xpack.significantEventsApp.pausedBannerPartialFailures', {
                        defaultMessage:
                          'Some maintenance operations could not be completed. Check Settings and the Kibana server logs for details.',
                      })}
                    </p>
                  )}
                  {canManageStreams && (
                    <EuiButton
                      href={link({ tab: 'settings' })}
                      color="warning"
                      size="s"
                      data-test-subj="significantEventsPausedBannerSettingsLink"
                    >
                      {i18n.translate('xpack.significantEventsApp.pausedBannerSettingsButton', {
                        defaultMessage: 'Go to Settings',
                      })}
                    </EuiButton>
                  )}
                </EuiCallOut>
                <EuiSpacer />
              </>
            )}
            {showMaintenanceBanners && <RunLimitsBanner />}
            {canonical.tab === 'data_sources' && <StreamsView />}
            {canonical.tab === 'knowledge_indicators' && kiView && (
              <>
                <ManagementSubTabs
                  items={kiSubtabs}
                  data-test-subj="significantEventsKnowledgeIndicatorsSubTabs"
                />
                <KnowledgeIndicatorsTable key={kiView} view={kiView} />
              </>
            )}
            {canonical.tab === 'significant_events' && (
              <>
                <ManagementSubTabs
                  items={significantEventsSubtabs}
                  data-test-subj="significantEventsSubTabs"
                />
                {canonical.subtab === undefined && <SignificantEventsTab />}
                {canonical.subtab === 'rules' && <QueriesTable />}
                {canonical.subtab === 'detections' && <DetectionsTab />}
              </>
            )}
            {canonical.tab === 'memory' && <MemoryTab />}
            {canonical.tab === 'settings' && <SettingsTab />}
          </SignificantEventsAppPageTemplate.Body>
        </SignificantEventsPageProvider>
      </KiGenerationProvider>
    </>
  );
}
