/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { tags } from '@kbn/scout';
import { expect } from '@kbn/scout/ui';
import { APP_HEADER_TEST_SUBJECTS } from '@kbn/app-header';
import { STREAMS_SIGNIFICANT_EVENTS_AVAILABLE_FLAG } from '@kbn/significant-events-plugin/common';
import { test } from '../fixtures';

test.describe(
  'Significant Events app',
  { tag: [...tags.stateful.classic, ...tags.serverless.observability.complete] },
  () => {
    test.beforeAll(async ({ apiServices, config }) => {
      // The /internal/core/_settings route used to force the flag on is only registered when
      // coreApp.allowDynamicConfigOverrides=true (Scout local base configs). ECH/MKI
      // deployments don't carry that override, so the PUT 404s — skip there.
      // eslint-disable-next-line playwright/no-skipped-test
      test.skip(
        config.isCloud === true,
        `Cannot override '${STREAMS_SIGNIFICANT_EVENTS_AVAILABLE_FLAG}' on Cloud deployments`
      );
      // skip() in beforeAll only skips the tests, not the hook body, so guard the requests too.
      if (config.isCloud) {
        return;
      }

      await apiServices.core.settings({
        'feature_flags.overrides': {
          [STREAMS_SIGNIFICANT_EVENTS_AVAILABLE_FLAG]: true,
        },
      });
    });

    test.beforeEach(async ({ browserAuth }) => {
      await browserAuth.loginAsAdmin();
    });

    test.afterAll(async ({ apiServices, config }) => {
      if (config.isCloud) {
        return;
      }
      await apiServices.core.settings({
        'feature_flags.overrides': {
          [STREAMS_SIGNIFICANT_EVENTS_AVAILABLE_FLAG]: false,
        },
      });
    });

    test('loads and redirects / to /data_sources tab by default', async ({ page }) => {
      await page.gotoApp('significant_events');
      await expect(page).toHaveURL(/\/app\/significant_events\/data_sources/, { timeout: 60_000 });

      await expect(page.testSubj.locator(APP_HEADER_TEST_SUBJECTS.root)).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.testSubj.locator(APP_HEADER_TEST_SUBJECTS.title)).toHaveText(
        'Nightshift Management'
      );
    });

    test('renders management navigation tabs', async ({ page }) => {
      await page.gotoApp('significant_events/data_sources');
      const tabBar = page.testSubj.locator(APP_HEADER_TEST_SUBJECTS.tabs);
      await expect(tabBar).toBeVisible({ timeout: 60_000 });

      for (const label of [
        'Data Sources',
        'Knowledge Indicators',
        'Significant Events',
        'Memory',
      ]) {
        await expect(tabBar.getByRole('tab', { name: label })).toBeVisible();
      }

      await expect(tabBar.getByRole('tab', { name: 'Settings' })).toHaveCount(0);
    });

    test('shows the not-enabled empty prompt when the feature flag is disabled', async ({
      apiServices,
      page,
    }) => {
      await apiServices.core.settings({
        'feature_flags.overrides': {
          [STREAMS_SIGNIFICANT_EVENTS_AVAILABLE_FLAG]: false,
        },
      });
      await page.gotoApp('significant_events/data_sources');
      await expect(page).toHaveURL(/\/app\/significant_events/, { timeout: 60_000 });
      await expect(page.testSubj.locator('significantEventsNotEnabledPrompt')).toBeVisible({
        timeout: 60_000,
      });
    });
  }
);
