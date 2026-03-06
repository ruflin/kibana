/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import { createServerRoute } from '../../../create_server_route';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';

const DEFAULT_LOOKBACK_HOURS = 1;

const scheduleBackfillRoute = createServerRoute({
  endpoint: 'POST /internal/streams/queries/_backfill',
  options: {
    access: 'internal',
    summary: 'Backfill sig events rules',
    description:
      'Schedules backfill for all promoted (rule-backed) sig events queries over a given time range. Defaults to the last 1 hour.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    body: z
      .object({
        start: z.string().optional(),
        end: z.string().optional(),
        lookbackHours: z.number().optional(),
        runActions: z.boolean().optional(),
      })
      .optional(),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
    logger,
  }): Promise<{ scheduled: number; skipped: number; errors: string[] }> => {
    const { queryClient, rulesClient, licensing, uiSettingsClient } = await getScopedClients({
      request,
    });

    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const body = params?.body ?? {};
    const now = new Date();
    const lookbackMs = (body.lookbackHours ?? DEFAULT_LOOKBACK_HOURS) * 60 * 60 * 1000;
    const end = body.end ?? now.toISOString();
    const start = body.start ?? new Date(now.getTime() - lookbackMs).toISOString();
    const runActions = body.runActions ?? false;

    const promotedLinks = await queryClient.getQueryLinks([], { ruleBacked: true });

    if (promotedLinks.length === 0) {
      return { scheduled: 0, skipped: 0, errors: ['No promoted (rule-backed) queries found'] };
    }

    const uniqueRuleIds = [...new Set(promotedLinks.map((link) => link.rule_id))];

    logger.info(
      `Scheduling backfill for ${uniqueRuleIds.length} rules from ${start} to ${end}`
    );

    const backfillParams = uniqueRuleIds.map((ruleId) => ({
      ruleId,
      ranges: [{ start, end }],
      runActions,
      initiator: 'user' as const,
    }));

    const results = await rulesClient.scheduleBackfill(backfillParams);

    let scheduled = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const result of results) {
      if ('error' in result) {
        const errorResult = result as { error: { message: string; rule?: { id: string } } };
        errors.push(
          `Rule ${errorResult.error.rule?.id ?? 'unknown'}: ${errorResult.error.message}`
        );
        skipped++;
      } else {
        scheduled++;
      }
    }

    logger.info(
      `Backfill scheduled: ${scheduled} rules, skipped: ${skipped}, errors: ${errors.length}`
    );

    return { scheduled, skipped, errors };
  },
});

export const internalBackfillRoutes = {
  ...scheduleBackfillRoute,
};
