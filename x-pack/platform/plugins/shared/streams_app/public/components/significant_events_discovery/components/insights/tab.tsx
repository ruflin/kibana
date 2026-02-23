/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { EuiLoadingElastic } from '@elastic/eui';
import { useKibana } from '../../../../hooks/use_kibana';
import { useStreamsAppFetch } from '../../../../hooks/use_streams_app_fetch';
import { Summary } from './summary';

export function InsightsTab() {
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();

  const insightsFetch = useStreamsAppFetch(
    async ({ signal }) =>
      streamsRepositoryClient.fetch('GET /internal/streams/_insights/all', {
        signal,
      }),
    [streamsRepositoryClient]
  );

  if (insightsFetch.loading) {
    return <EuiLoadingElastic />;
  }

  const persistedInsights = insightsFetch.value?.insights ?? [];

  return (
    <Summary
      persistedInsights={persistedInsights}
      onInsightsChanged={insightsFetch.refresh}
    />
  );
}
