/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';

export const TOPOLOGY_MAP_TITLE = i18n.translate(
  'xpack.significantEventsApp.knowledgeIndicators.topologyMapTitle',
  { defaultMessage: 'Topology overview' }
);

export const TOPOLOGY_MAP_EMPTY = i18n.translate(
  'xpack.significantEventsApp.knowledgeIndicators.topologyMapEmpty',
  {
    defaultMessage:
      'No topology knowledge indicators yet. Generate topology from existing knowledge indicators, or extract them from Data Sources.',
  }
);

export const TOPOLOGY_MAP_ENTITY_COUNT = (count: number) =>
  i18n.translate('xpack.significantEventsApp.knowledgeIndicators.topologyMapEntityCount', {
    defaultMessage: '{count, plural, one {# entity} other {# entities}}',
    values: { count },
  });

export const TOPOLOGY_MAP_TECHNOLOGY_COUNT = (count: number) =>
  i18n.translate('xpack.significantEventsApp.knowledgeIndicators.topologyMapTechnologyCount', {
    defaultMessage: '{count, plural, one {# technology} other {# technologies}}',
    values: { count },
  });

export const TOPOLOGY_MAP_INFRASTRUCTURE_COUNT = (count: number) =>
  i18n.translate('xpack.significantEventsApp.knowledgeIndicators.topologyMapInfrastructureCount', {
    defaultMessage: '{count, plural, one {# infrastructure} other {# infrastructure}}',
    values: { count },
  });

export const TOPOLOGY_MAP_DEPENDENCY_COUNT = (count: number) =>
  i18n.translate('xpack.significantEventsApp.knowledgeIndicators.topologyMapDependencyCount', {
    defaultMessage: '{count, plural, one {# dependency} other {# dependencies}}',
    values: { count },
  });

export const TOPOLOGY_MAP_LOADING = i18n.translate(
  'xpack.significantEventsApp.knowledgeIndicators.topologyMapLoading',
  { defaultMessage: 'Loading topology map' }
);

export const TOPOLOGY_MAP_ERROR_TITLE = i18n.translate(
  'xpack.significantEventsApp.knowledgeIndicators.topologyMapErrorTitle',
  { defaultMessage: 'Topology map could not be displayed' }
);

export const TOPOLOGY_MAP_UNRESOLVED_TITLE = (count: number) =>
  i18n.translate('xpack.significantEventsApp.knowledgeIndicators.topologyMapUnresolvedTitle', {
    defaultMessage:
      '{count, plural, one {# dependency endpoint could not be resolved} other {# dependency endpoints could not be resolved}}',
    values: { count },
  });

export const TOPOLOGY_MAP_UNRESOLVED_DESCRIPTION = (refs: string) =>
  i18n.translate('xpack.significantEventsApp.knowledgeIndicators.topologyMapUnresolvedDescription', {
    defaultMessage:
      'These endpoints are listed from dependency knowledge indicators and were not invented as nodes: {refs}.',
    values: { refs },
  });

export const TOPOLOGY_NODE_ARIA_LABEL = ({
  type,
  label,
}: {
  type: string;
  label: string;
}): string =>
  i18n.translate('xpack.significantEventsApp.knowledgeIndicators.topologyNodeAriaLabel', {
    defaultMessage: '{type} {label}',
    values: { type, label },
  });
