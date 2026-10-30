/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import {
  EuiIcon,
  EuiLoadingSpinner,
  EuiPageTemplate,
  EuiSpacer,
  EuiTab,
  EuiTabs,
} from '@elastic/eui';
import { reactRouterNavigate } from '@kbn/kibana-react-plugin/public';
import { Redirect, useHistory, useParams } from 'react-router-dom';
import { NightshiftAppHeader } from '../components/app_header';
import type { NightshiftHeaderNavigation } from '../components/app_header';
import { useKnowledgeTabsAvailability } from './hooks/use_knowledge_tabs_availability';
import {
  getVisibleKnowledgeTabs,
  getDefaultKnowledgeTab,
  isKnowledgeTabId,
  KNOWLEDGE_TAB_LABELS,
} from './knowledge_tabs';
const KnowledgeIndicatorsTab = React.lazy(() =>
  import('./knowledge_indicators/tab').then((module) => ({
    default: module.KnowledgeIndicatorsTab,
  }))
);
const CortexTab = React.lazy(() =>
  import('./cortex/tab').then((module) => ({ default: module.CortexTab }))
);
const MemoryTab = React.lazy(() =>
  import('./memory/tab').then((module) => ({ default: module.MemoryTab }))
);
const DecisionTreesTab = React.lazy(() =>
  import('./decision_trees/tab').then((module) => ({ default: module.DecisionTreesTab }))
);

export type KnowledgePageHeaderProps = NightshiftHeaderNavigation;

const KnowledgeLoadingSpinner = () => (
  <EuiLoadingSpinner size="xl" data-test-subj="nightshiftKnowledgePageLoading" />
);

const KnowledgePageLoading = () => (
  <EuiPageTemplate.Section component="div" restrictWidth={false}>
    <KnowledgeLoadingSpinner />
  </EuiPageTemplate.Section>
);

export function KnowledgePage({
  headerProps,
}: {
  headerProps: KnowledgePageHeaderProps;
}): React.ReactElement {
  const { tab } = useParams<{ tab?: string }>();
  const history = useHistory();
  const availability = useKnowledgeTabsAvailability();

  if (tab && isKnowledgeTabId(tab) && availability[tab].isLoading) {
    return <KnowledgePageLoading />;
  }

  const isVisibleRequestedTab =
    tab !== undefined && isKnowledgeTabId(tab) && availability[tab].isEnabled;

  if (!isVisibleRequestedTab) {
    const defaultTab = getDefaultKnowledgeTab(availability);
    if (defaultTab === 'loading') {
      return <KnowledgePageLoading />;
    }

    return <Redirect to={defaultTab ? `/knowledge/${defaultTab}` : '/'} />;
  }

  const visibleTabs = getVisibleKnowledgeTabs(availability);

  return (
    <>
      <NightshiftAppHeader {...headerProps} page="knowledge" />
      <EuiPageTemplate.Section component="div" restrictWidth={false}>
        <EuiTabs size="s">
          {visibleTabs.map((id) => (
            <EuiTab
              key={id}
              isSelected={tab === id}
              {...reactRouterNavigate(history, `/knowledge/${id}`)}
              data-test-subj={`nightshiftKnowledgeTab-${id}`}
            >
              {KNOWLEDGE_TAB_LABELS[id]}
              {id === 'decision_trees' && <EuiIcon type="code" aria-hidden="true" />}
            </EuiTab>
          ))}
        </EuiTabs>
        <EuiSpacer size="m" />
        <React.Suspense fallback={<KnowledgeLoadingSpinner />}>
          {tab === 'knowledge_indicators' && <KnowledgeIndicatorsTab />}
          {tab === 'cortex' && <CortexTab />}
          {tab === 'memory' && <MemoryTab />}
          {tab === 'decision_trees' && <DecisionTreesTab />}
        </React.Suspense>
      </EuiPageTemplate.Section>
    </>
  );
}
