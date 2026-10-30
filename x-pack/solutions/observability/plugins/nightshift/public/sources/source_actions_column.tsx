/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiButtonIcon, EuiContextMenu, EuiPopover, EuiToolTip } from '@elastic/eui';
import type {
  EuiContextMenuPanelDescriptor,
  EuiContextMenuPanelItemDescriptor,
} from '@elastic/eui';
import type { NightshiftSource } from '@kbn/nightshift-shared';
import {
  SignificantEventsWorkflowStatus,
  type SignificantEventsWorkflowStatusResult,
} from '@kbn/significant-events-schema';
import React, { useState } from 'react';
import {
  FEATURES_MODEL_ROW_LABEL,
  GENERATE_BUTTON_LABEL,
  GENERATE_FEATURES_BUTTON_LABEL,
  GENERATE_QUERIES_BUTTON_LABEL,
  QUERIES_MODEL_ROW_LABEL,
} from './onboarding/translations';
import {
  buildConnectorMenuItem,
  buildConnectorSelectionPanel,
} from './onboarding/context_menu_helpers';
import { useGenerateConnectors } from './onboarding/use_generate_connectors';
import type { GenerateRun, RowGenerateProps } from './onboarding/types';
import {
  DELETE_SOURCE_ACTION_LABEL,
  ENABLE_SOURCE_TO_ONBOARD_TOOLTIP,
  ONBOARDING_STARTING_TOOLTIP,
  SOURCE_ACTIONS_LABEL,
  STOP_SOURCE_ONBOARDING_BUTTON_LABEL,
} from './translations';
import { isOnboardingInProgress } from './utils';

interface SourceActionsColumnProps {
  source: NightshiftSource;
  onboardingStatus?: SignificantEventsWorkflowStatusResult['status'];
  /** Global pause or unknown activity status: onboarding cannot start. */
  blocksActivity: boolean;
  /** Run expected but not reported yet: a schedule in flight or a just-created or edited source. */
  isOnboardPending: boolean;
  onboardTooltip: string;
  generate: RowGenerateProps;
  onStopOnboarding: (sourceId: string) => void | Promise<void>;
  onDelete: (source: NightshiftSource) => void;
}

/** One three-dot menu per source: generate runs and their models, stop and delete. */
export function SourceActionsColumn({
  source,
  onboardingStatus,
  blocksActivity,
  isOnboardPending,
  onboardTooltip,
  generate,
  onStopOnboarding,
  onDelete,
}: SourceActionsColumnProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuResetKey, setMenuResetKey] = useState(0);
  const [isStopPending, setIsStopPending] = useState(false);

  const { config, allConnectors, featuresResolvedConnectorId, queriesResolvedConnectorId } =
    generate;
  const {
    defaultConnectorOnly,
    featuresConnector,
    queriesConnector,
    onSelectFeaturesConnector,
    onSelectQueriesConnector,
  } = useGenerateConnectors({
    config,
    allConnectors,
    onConfigChange: generate.onConfigChange,
  });

  // A resolved cancel stays InProgress until the next poll. Drop the lock once status moves on,
  // so a later run of this source is not stuck with a disabled stop item.
  if (isStopPending && onboardingStatus !== SignificantEventsWorkflowStatus.InProgress) {
    setIsStopPending(false);
  }

  const isRunActive = isOnboardingInProgress(onboardingStatus);
  // Pending covers the gap before status reports the run, e.g. a just-created source whose run the
  // server has not started yet. There is nothing to cancel then, so Stop shows but stays disabled.
  const isRunStarting = isOnboardPending && !isRunActive;
  const isRunBusy = isRunActive || isRunStarting;

  const closeMenu = () => {
    setIsOpen(false);
    setMenuResetKey((key) => key + 1);
  };
  // Picking a model keeps the menu open and returns it to the root panel.
  const resetMenu = () => setMenuResetKey((key) => key + 1);

  const handleStopOnboarding = async () => {
    setIsStopPending(true);
    try {
      await onStopOnboarding(source.id);
    } catch {
      // Status will not move, so the item has to accept another attempt.
      setIsStopPending(false);
    }
  };

  const isBlocked = !source.enabled || generate.isRunDisabled || isRunBusy;
  const blockedTooltip = !source.enabled
    ? ENABLE_SOURCE_TO_ONBOARD_TOOLTIP
    : blocksActivity
    ? onboardTooltip
    : undefined;
  const canRun: Record<GenerateRun, boolean> = {
    all: !isBlocked && Boolean(featuresConnector && queriesConnector),
    features: !isBlocked && Boolean(featuresConnector),
    queries: !isBlocked && Boolean(queriesConnector),
  };

  const buildRunItem = (
    run: GenerateRun,
    name: string,
    dataTestSubj: string
  ): EuiContextMenuPanelItemDescriptor => ({
    name,
    disabled: !canRun[run],
    toolTipContent: canRun[run] ? undefined : blockedTooltip,
    toolTipProps: { position: 'right' },
    onClick: () => {
      closeMenu();
      generate.onRun(source.id, run);
    },
    'data-test-subj': dataTestSubj,
  });

  const panels: EuiContextMenuPanelDescriptor[] = [
    {
      id: 0,
      items: [
        buildRunItem('all', GENERATE_BUTTON_LABEL, 'significantEventsAppSourceGenerateAll'),
        buildRunItem(
          'features',
          GENERATE_FEATURES_BUTTON_LABEL,
          'significantEventsAppSourceGenerateFeatures'
        ),
        buildRunItem(
          'queries',
          GENERATE_QUERIES_BUTTON_LABEL,
          'significantEventsAppSourceGenerateQueries'
        ),
        { isSeparator: true },
        {
          ...buildConnectorMenuItem({
            connector: featuresConnector,
            selectedConnectorId: config.connectors.features,
            resolvedConnectorId: featuresResolvedConnectorId,
            panelId: 1,
            label: FEATURES_MODEL_ROW_LABEL,
          }),
          'data-test-subj': 'significantEventsAppSourceFeaturesModel',
        },
        {
          ...buildConnectorMenuItem({
            connector: queriesConnector,
            selectedConnectorId: config.connectors.queries,
            resolvedConnectorId: queriesResolvedConnectorId,
            panelId: 2,
            label: QUERIES_MODEL_ROW_LABEL,
          }),
          'data-test-subj': 'significantEventsAppSourceQueriesModel',
        },
        { isSeparator: true },
        ...(isRunBusy
          ? [
              {
                name: STOP_SOURCE_ONBOARDING_BUTTON_LABEL,
                icon: 'stop' as const,
                disabled:
                  isRunStarting ||
                  isStopPending ||
                  onboardingStatus === SignificantEventsWorkflowStatus.BeingCanceled,
                toolTipContent: isRunStarting ? ONBOARDING_STARTING_TOOLTIP : undefined,
                onClick: () => {
                  closeMenu();
                  void handleStopOnboarding();
                },
                'data-test-subj': 'significantEventsAppSourcesTableStopButton',
              },
            ]
          : []),
        {
          name: DELETE_SOURCE_ACTION_LABEL,
          icon: 'trash' as const,
          color: 'danger' as const,
          onClick: () => {
            closeMenu();
            onDelete(source);
          },
          'data-test-subj': 'significantEventsAppSourcesTableDeleteButton',
        },
      ],
    },
    {
      id: 1,
      ...buildConnectorSelectionPanel({
        connectors: allConnectors,
        resolvedConnectorId: featuresResolvedConnectorId,
        selectedConnectorId: config.connectors.features,
        defaultConnectorOnly,
        onSelect: (connectorId) => {
          onSelectFeaturesConnector(connectorId);
          resetMenu();
        },
      }),
    },
    {
      id: 2,
      ...buildConnectorSelectionPanel({
        connectors: allConnectors,
        resolvedConnectorId: queriesResolvedConnectorId,
        selectedConnectorId: config.connectors.queries,
        defaultConnectorOnly,
        onSelect: (connectorId) => {
          onSelectQueriesConnector(connectorId);
          resetMenu();
        },
      }),
    },
  ];

  return (
    <EuiPopover
      aria-label={SOURCE_ACTIONS_LABEL}
      button={
        <EuiToolTip content={SOURCE_ACTIONS_LABEL} disableScreenReaderOutput>
          <EuiButtonIcon
            data-test-subj="significantEventsAppSourcesTableActionsButton"
            iconType="ellipsis"
            aria-label={SOURCE_ACTIONS_LABEL}
            onClick={() => setIsOpen((open) => !open)}
          />
        </EuiToolTip>
      }
      isOpen={isOpen}
      closePopover={closeMenu}
      panelPaddingSize="none"
      anchorPosition="downRight"
    >
      <EuiContextMenu key={menuResetKey} initialPanelId={0} panels={panels} />
    </EuiPopover>
  );
}
