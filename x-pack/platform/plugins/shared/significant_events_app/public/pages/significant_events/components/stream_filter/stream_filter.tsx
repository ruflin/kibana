/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';
import type { KnowledgeIndicator } from '@kbn/nightshift-ai';
import React, { useMemo } from 'react';
import { KnowledgeIndicatorSelectableFilter } from '../../../../components/knowledge_indicators/knowledge_indicator_selectable_filter';
import { getKnowledgeIndicatorStreamName } from '../../../../components/knowledge_indicators/utils/get_knowledge_indicator_stream_name';
import type { KnowledgeIndicatorView } from '../../../../components/knowledge_indicators/utils/get_knowledge_indicator_view';

interface StreamFilterProps {
  knowledgeIndicators: KnowledgeIndicator[];
  searchTerm: string;
  statusFilter: 'active' | 'excluded';
  selectedTypes: string[];
  hideComputedTypes: boolean;
  selectedStreams: string[];
  onSelectedStreamsChange: (selectedStreams: string[]) => void;
  view?: KnowledgeIndicatorView;
}

export function StreamFilter({
  knowledgeIndicators,
  searchTerm,
  statusFilter,
  selectedTypes,
  hideComputedTypes,
  selectedStreams,
  onSelectedStreamsChange,
  view,
}: StreamFilterProps) {
  const filterCriteria = useMemo(
    () => ({ statusFilter, selectedTypes, hideComputedTypes, view }),
    [statusFilter, selectedTypes, hideComputedTypes, view]
  );

  return (
    <KnowledgeIndicatorSelectableFilter
      knowledgeIndicators={knowledgeIndicators}
      searchTerm={searchTerm}
      getValue={getKnowledgeIndicatorStreamName}
      selected={selectedStreams}
      onSelectedChange={onSelectedStreamsChange}
      labels={{
        button: i18n.translate('xpack.significantEventsApp.knowledgeIndicators.streamFilterLabel', {
          defaultMessage: 'Stream',
        }),
        groupLabel: i18n.translate(
          'xpack.significantEventsApp.knowledgeIndicators.streamFilterGroupLabel',
          {
            defaultMessage: 'Filter by stream',
          }
        ),
        popoverAriaLabel: i18n.translate(
          'xpack.significantEventsApp.knowledgeIndicators.streamFilterPopoverLabel',
          { defaultMessage: 'Stream filter' }
        ),
        selectableAriaLabel: i18n.translate(
          'xpack.significantEventsApp.knowledgeIndicators.streamFilterSelectableAriaLabel',
          { defaultMessage: 'Filter knowledge indicators by stream' }
        ),
      }}
      filterCriteria={filterCriteria}
    />
  );
}
