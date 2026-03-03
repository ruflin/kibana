/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsType } from '@kbn/core/server';
import { schema, type TypeOf } from '@kbn/config-schema';

export const discoverySettingsSOType = 'stream-discovery-settings';
export const DISCOVERY_SETTINGS_SO_ID = 'default';

export const discoverySettingsSOAttributesV1 = schema.object({
  featureExtractionConnectorId: schema.maybe(schema.string()),
  queryGenerationConnectorId: schema.maybe(schema.string()),
  discoveryConnectorId: schema.maybe(schema.string()),
  suggestionConnectorId: schema.maybe(schema.string()),
});

export type DiscoverySettingsAttributes = TypeOf<typeof discoverySettingsSOAttributesV1>;

export const getDiscoverySettingsSavedObject = (): SavedObjectsType => {
  return {
    name: discoverySettingsSOType,
    hidden: false,
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
          forwardCompatibility: discoverySettingsSOAttributesV1.extends({}, { unknowns: 'ignore' }),
          create: discoverySettingsSOAttributesV1,
        },
      },
    },
  };
};
