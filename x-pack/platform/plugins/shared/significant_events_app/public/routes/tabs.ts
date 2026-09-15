/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export {
  MANAGEMENT_TABS,
  KI_SUBTABS,
  SIGNIFICANT_EVENTS_NESTED_SUBTABS,
  DEFAULT_MANAGEMENT_TAB,
  DEFAULT_KI_SUBTAB,
  isManagementTab,
  isKiSubtab,
  isSignificantEventsNestedSubtab,
  resolveManagementLocation,
  buildManagementPath,
  type ManagementTab,
  type KnowledgeIndicatorsSubtab,
  type SignificantEventsNestedSubtab,
  type CanonicalManagementLocation,
} from '../../common/tabs';
