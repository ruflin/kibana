/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsType } from '@kbn/core/server';
import { schema, type TypeOf } from '@kbn/config-schema';

export const SIGNIFICANT_EVENTS_DATA_VIEWS_SO_TYPE = 'significant-events-data-views';

/**
 * One document per Kibana space listing the ES|QL views configured as Significant
 * Events data sources, plus whether each is enabled and owned by this plugin.
 */
export const SIGNIFICANT_EVENTS_DATA_VIEWS_SO_ID = 'significant-events-data-views';

const MAX_DATA_VIEWS = 100;
const MAX_VIEW_NAME_LENGTH = 255;
const MAX_VIEW_QUERY_LENGTH = 10000;

const dataViewSchemaV1 = schema.object({
  name: schema.string({ minLength: 1, maxLength: MAX_VIEW_NAME_LENGTH }),
  enabled: schema.boolean(),
  owned: schema.boolean(),
  query: schema.maybe(schema.string({ maxLength: MAX_VIEW_QUERY_LENGTH })),
});

const dataViewsAttributesV1 = schema.object({
  views: schema.arrayOf(dataViewSchemaV1, { maxSize: MAX_DATA_VIEWS }),
});

export type SignificantEventsDataViewsAttributes = TypeOf<typeof dataViewsAttributesV1>;

export const getSignificantEventsDataViewsSavedObjectType = (): SavedObjectsType => ({
  name: SIGNIFICANT_EVENTS_DATA_VIEWS_SO_TYPE,
  hidden: true,
  namespaceType: 'multiple',
  mappings: {
    dynamic: false,
    properties: {},
  },
  management: {
    importableAndExportable: false,
  },
  modelVersions: {
    '1': {
      changes: [],
      schemas: {
        forwardCompatibility: dataViewsAttributesV1.extends({}, { unknowns: 'ignore' }),
        create: dataViewsAttributesV1,
      },
    },
  },
});
