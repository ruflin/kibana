/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AppUpdater, ChromeStart, PluginInitializerContext } from '@kbn/core/public';
import {
  catchError,
  combineLatest,
  from,
  map,
  of,
  Subscription,
  type BehaviorSubject,
  type Observable,
} from 'rxjs';
import type { FocusedSignificantEventService } from './chat/focused_significant_event_service';
import type { NightshiftStartDependencies } from './types';

/**
 * Deep links shown in the Kibana left nav. Every other deep link stays in global search only.
 * Automations is additionally gated on the feature flag and the investigations client.
 */
const SIDE_NAV_LINK_IDS: readonly string[] = [
  'automations',
  'detections',
  'knowledge_indicators',
  'settings',
  'sources',
];

/** Starts focused-event auto-attach and updates app visibility from the detection availability API. */
export const startNightshiftServices = ({
  pluginsStart,
  appUpdater$,
  context,
  chrome,
  focusedSignificantEventService,
  automationsFlag$,
}: {
  pluginsStart: NightshiftStartDependencies;
  appUpdater$: BehaviorSubject<AppUpdater>;
  context: PluginInitializerContext;
  chrome: ChromeStart;
  focusedSignificantEventService: FocusedSignificantEventService;
  automationsFlag$: Observable<boolean>;
}): Subscription => {
  const subscription = new Subscription();

  // Single source of truth: aggregates rollout flag, project type, pricing tier, license and
  // required plugins. The flag alone would surface the app where the feature cannot run.
  const isAvailable$ = from(
    pluginsStart.significantEvents.significantEventsRepositoryClient.fetch(
      'GET /internal/significant_events/availability',
      { signal: null }
    )
  ).pipe(
    map(({ available }) => available),
    catchError((error) => {
      context.logger
        .get('nightshiftAvailability')
        .error(`Failed to fetch Significant Events availability: ${error}`);
      return of(false);
    })
  );

  subscription.add(
    combineLatest([isAvailable$, automationsFlag$])
      .pipe(
        map(
          ([isAvailable, automationsFlagEnabled]): AppUpdater =>
            (app) => {
              const canUseAutomations =
                automationsFlagEnabled &&
                pluginsStart.nightshiftInvestigations?.investigationsClient != null;
              return {
                visibleIn: isAvailable ? ['globalSearch', 'projectSideNav'] : [],
                deepLinks: (app.deepLinks ?? []).map((link) => {
                  if (!isAvailable || (link.id === 'automations' && !canUseAutomations)) {
                    return { ...link, visibleIn: [] };
                  }
                  return {
                    ...link,
                    visibleIn: SIDE_NAV_LINK_IDS.includes(link.id)
                      ? ['globalSearch', 'projectSideNav']
                      : ['globalSearch'],
                  };
                }),
              };
            }
        )
      )
      .subscribe(appUpdater$)
  );

  const { agentBuilder } = pluginsStart;
  if (agentBuilder) {
    const logger = context.logger.get('nightshiftAgentBuilderAttachments');
    void import('./chat/agent_builder/significant_event_attachments')
      .then(({ registerNightshiftAgentBuilderAttachments }) => {
        const cleanup = registerNightshiftAgentBuilderAttachments({
          agentBuilder,
          chrome,
          share: pluginsStart.share,
          focusedSignificantEventService,
          logger,
        });
        subscription.add(cleanup);
      })
      .catch((error) => {
        logger.error(`Failed to register agent builder attachments: ${error}`);
      });
  }

  return subscription;
};
