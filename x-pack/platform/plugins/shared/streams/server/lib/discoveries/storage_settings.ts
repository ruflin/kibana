/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IndexStorageSettings } from '@kbn/storage-adapter';
import { types } from '@kbn/storage-adapter';
import {
  DISCOVERY_UUID,
  DISCOVERY_DOC_TYPE,
  DISCOVERY_TITLE,
  DISCOVERY_TITLE_SEMANTIC,
  DISCOVERY_DESCRIPTION,
  DISCOVERY_DESCRIPTION_SEMANTIC,
  DISCOVERY_SEVERITY,
  DISCOVERY_RELEVANCE_SCORE,
  DISCOVERY_EVIDENCE,
  DISCOVERY_SAMPLE_EVENTS,
  DISCOVERY_RECOMMENDATIONS,
  DISCOVERY_FEATURE_REFS,
  DISCOVERY_QUERY_REFS,
  DISCOVERY_STREAM_REFS,
  DISCOVERY_DISCOVERY_REFS,
  DISCOVERY_LEVEL,
  DISCOVERY_CREATED_AT,
  DISCOVERY_UPDATED_AT,
  DISCOVERY_CONNECTOR_ID,
  DISCOVERY_TAGS,
  DISCOVERY_FEEDBACK,
  SUGGESTION_TYPE,
  SUGGESTION_ESQL_QUERY,
  SUGGESTION_ESQL_QUERY_SEMANTIC,
  SUGGESTION_QUERY_TYPE,
  SUGGESTION_REASON,
  SUGGESTION_PRIORITY,
  SUGGESTION_STATUS,
} from './fields';

export const SEMANTIC_TEXT_INFERENCE_ID = '.elser-2-elasticsearch';

export const discoveryStorageSettings = {
  name: '.kibana_streams_discoveries',
  schema: {
    properties: {
      [DISCOVERY_UUID]: types.keyword(),
      [DISCOVERY_DOC_TYPE]: types.keyword(),
      [DISCOVERY_TITLE]: types.keyword(),
      [DISCOVERY_TITLE_SEMANTIC]: types.semantic_text({
        inference_id: SEMANTIC_TEXT_INFERENCE_ID,
      }),
      [DISCOVERY_DESCRIPTION]: types.text(),
      [DISCOVERY_DESCRIPTION_SEMANTIC]: types.semantic_text({
        inference_id: SEMANTIC_TEXT_INFERENCE_ID,
      }),
      [DISCOVERY_SEVERITY]: types.keyword(),
      [DISCOVERY_RELEVANCE_SCORE]: types.long(),
      [DISCOVERY_EVIDENCE]: types.object({ enabled: false }),
      [DISCOVERY_SAMPLE_EVENTS]: types.object({ enabled: false }),
      [DISCOVERY_RECOMMENDATIONS]: types.object({ enabled: false }),
      [DISCOVERY_FEATURE_REFS]: types.keyword(),
      [DISCOVERY_QUERY_REFS]: types.keyword(),
      [DISCOVERY_STREAM_REFS]: types.keyword(),
      [DISCOVERY_DISCOVERY_REFS]: types.keyword(),
      [DISCOVERY_LEVEL]: types.long(),
      [DISCOVERY_CREATED_AT]: types.date(),
      [DISCOVERY_UPDATED_AT]: types.date(),
      [DISCOVERY_CONNECTOR_ID]: types.keyword(),
      [DISCOVERY_TAGS]: types.keyword(),
      [DISCOVERY_FEEDBACK]: types.keyword(),
      [SUGGESTION_TYPE]: types.keyword(),
      [SUGGESTION_ESQL_QUERY]: types.text(),
      [SUGGESTION_ESQL_QUERY_SEMANTIC]: types.semantic_text({
        inference_id: SEMANTIC_TEXT_INFERENCE_ID,
      }),
      [SUGGESTION_QUERY_TYPE]: types.keyword(),
      [SUGGESTION_REASON]: types.text(),
      [SUGGESTION_PRIORITY]: types.keyword(),
      [SUGGESTION_STATUS]: types.keyword(),
    },
  },
} satisfies IndexStorageSettings;

export type DiscoveryStorageSettings = typeof discoveryStorageSettings;
