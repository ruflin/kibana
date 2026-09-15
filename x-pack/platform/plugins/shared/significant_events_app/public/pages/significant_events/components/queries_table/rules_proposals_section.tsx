/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiBadge,
  EuiBasicTable,
  EuiButtonEmpty,
  EuiFlexGroup,
  EuiFlexItem,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { QUERY_TYPE_MATCH, QUERY_TYPE_STATS } from '@kbn/significant-events-schema';
import { useMutation } from '@kbn/react-query';
import React, { useMemo } from 'react';
import {
  useFetchDiscoveryQueries,
  type SignificantEventQueryRow,
} from '../../../../hooks/use_fetch_discovery_queries';
import { useQueriesApi, type PromoteResult } from '../../../../hooks/use_queries_api';
import { useInvalidatePromoteRelatedQueries } from '../../../../hooks/use_invalidate_promote_queries';
import { useKibana } from '../../../../hooks/use_kibana';
import { useBlocksNewActivity } from '../../../../hooks/use_significant_events_maintenance';
import { getFormattedError } from '../../../../util/errors';
import { getPromoteSkipReason } from '../../../../lib/promote_skip_reason';
import { SeverityBadge } from '../severity_badge/severity_badge';
import { QueryTypeBadge } from '../query_type_badge/query_type_badge';
import {
  IMPACT_COLUMN,
  PROMOTE_RULE_ACTION_DESCRIPTION,
  PROMOTE_RULE_ACTION_TITLE,
  PROMOTE_RULE_ERROR_TITLE,
  PROMOTE_RULE_SUCCESS_TITLE,
  RULES_PROPOSALS_DESCRIPTION,
  RULES_PROPOSALS_TITLE,
  STATS_PROMOTE_DISABLED_TOOLTIP,
  STREAM_COLUMN,
  TITLE_COLUMN,
} from './translations';

export function RulesProposalsSection() {
  const {
    core: {
      notifications: { toasts },
    },
  } = useKibana();
  const { blocksActivity, activityBlockTooltip } = useBlocksNewActivity();
  const { promote } = useQueriesApi();
  const invalidatePromoteRelatedQueries = useInvalidatePromoteRelatedQueries();

  const { data, isLoading } = useFetchDiscoveryQueries({
    query: '',
    page: 1,
    perPage: 50,
    status: ['draft'],
  });

  const proposals = data?.queries ?? [];

  const promoteMutation = useMutation<PromoteResult, Error, string>({
    mutationFn: (queryId) => promote({ queryIds: [queryId] }),
    onSuccess: async (result) => {
      const skipReason = getPromoteSkipReason(result);
      if (!skipReason) {
        toasts.addSuccess({ title: PROMOTE_RULE_SUCCESS_TITLE });
      } else if (result.promoted > 0) {
        toasts.addWarning({ title: skipReason });
      } else {
        toasts.addInfo({ title: skipReason });
      }
      await invalidatePromoteRelatedQueries();
    },
    onError: (error) => {
      toasts.addError(getFormattedError(error), { title: PROMOTE_RULE_ERROR_TITLE });
    },
  });

  const columns: Array<EuiBasicTableColumn<SignificantEventQueryRow>> = useMemo(
    () => [
      {
        field: 'query.title',
        name: TITLE_COLUMN,
        render: (_: unknown, item: SignificantEventQueryRow) => item.query.title,
      },
      {
        field: 'query.severity_score',
        name: IMPACT_COLUMN,
        width: '100px',
        render: (_: unknown, item: SignificantEventQueryRow) => (
          <SeverityBadge score={item.query.severity_score} />
        ),
      },
      {
        field: 'query.type',
        name: i18n.translate('xpack.significantEventsApp.queriesTable.proposalsTypeColumn', {
          defaultMessage: 'Type',
        }),
        width: '80px',
        render: (_: unknown, item: SignificantEventQueryRow) => (
          <QueryTypeBadge type={item.query.type ?? QUERY_TYPE_MATCH} />
        ),
      },
      {
        field: 'stream_name',
        name: STREAM_COLUMN,
        width: '130px',
        render: (_: unknown, item: SignificantEventQueryRow) => (
          <EuiBadge color="hollow">{item.stream_name}</EuiBadge>
        ),
      },
      {
        name: PROMOTE_RULE_ACTION_TITLE,
        width: '120px',
        render: (item: SignificantEventQueryRow) => {
          const isStats = item.query.type === QUERY_TYPE_STATS;
          const isDisabled = blocksActivity || isStats || promoteMutation.isLoading;
          const tooltip =
            activityBlockTooltip ?? (isStats ? STATS_PROMOTE_DISABLED_TOOLTIP : undefined);
          const button = (
            <EuiButtonEmpty
              iconType="plusCircle"
              size="xs"
              aria-label={PROMOTE_RULE_ACTION_DESCRIPTION}
              isDisabled={isDisabled}
              isLoading={promoteMutation.isLoading}
              onClick={() => promoteMutation.mutate(item.query.id)}
              data-test-subj="significantEventsPromoteProposedRule"
            >
              {PROMOTE_RULE_ACTION_TITLE}
            </EuiButtonEmpty>
          );
          return tooltip ? <EuiToolTip content={tooltip}>{button}</EuiToolTip> : button;
        },
      },
    ],
    [activityBlockTooltip, blocksActivity, promoteMutation]
  );

  if (isLoading || proposals.length === 0) {
    return null;
  }

  return (
    <EuiPanel hasBorder hasShadow={false} data-test-subj="significantEventsRulesProposals">
      <EuiFlexGroup direction="column" gutterSize="s">
        <EuiFlexItem>
          <EuiTitle size="xs">
            <h3>{RULES_PROPOSALS_TITLE}</h3>
          </EuiTitle>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="s" color="subdued">
            <p>{RULES_PROPOSALS_DESCRIPTION}</p>
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiBasicTable
            items={proposals}
            itemId={(item) => item.query.id}
            columns={columns}
            tableCaption={RULES_PROPOSALS_TITLE}
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
    </EuiPanel>
  );
}
