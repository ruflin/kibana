/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { alertFieldMap } from '@kbn/alerts-as-data-utils';
import type { FieldMap } from '@kbn/alerts-as-data-utils';

/**
 * Semconv resource field names extracted from source documents and indexed as
 * top-level keywords on the alerts index so they can be filtered and aggregated.
 */
export const ALERT_RESOURCE_FIELD_NAMES = [
  'service.name',
  'host.name',
  'service.environment',
  'service.version',
  'service.node.name',
  'host.id',
  'host.architecture',
  'container.id',
  'container.name',
  'cloud.provider',
  'cloud.region',
  'cloud.availability_zone',
  'cloud.account.id',
  'agent.name',
] as const;

const resourceFieldMap: FieldMap = Object.fromEntries(
  ALERT_RESOURCE_FIELD_NAMES.map((field) => [
    field,
    { type: 'keyword', array: false, required: false },
  ])
);

export const streamsAlertFieldMap: FieldMap = {
  ...alertFieldMap,
  original_source: { type: 'flattened', array: false, required: false },
  'stream.name': { type: 'keyword', array: false, required: false },
  pattern_text: { type: 'match_only_text', array: false, required: false },
  'body.text': { type: 'match_only_text', array: false, required: false },
  ...resourceFieldMap,
};
