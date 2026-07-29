/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Entities tab — Entity Store POC, item 1.
 *
 * Lists entities from the Security Entity Store's `service` engine, entirely through
 * significant_events-owned proxy routes (see `use_entity_store_poc.ts` and the server
 * plugin's `lib/entity_store_poc`). See the POC issue for full scope:
 * AI-Memory kibana/issues/2026-07-29-feat-entity-store-poc-for-observability.md
 */

import React, { useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTable,
  EuiButton,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiCallOut,
  EuiFieldSearch,
  EuiFlexGroup,
  EuiFlexItem,
  EuiToolTip,
  useEuiTheme,
} from '@elastic/eui';
import type { EuiBasicTableColumn } from '@elastic/eui';
import { css } from '@emotion/react';
import { i18n } from '@kbn/i18n';
import { formatTimestamp } from '../../../../../util/formatters';
import {
  useEntityStorePocPagination,
  useFetchEntityStorePocEntities,
  useInstallEntityStorePocMutation,
  type EntityStorePocEntity,
} from './use_entity_store_poc';
import { EntityFlyout } from './entity_flyout';
import { PromoteKiModal } from './promote_ki_modal';

export const EntitiesTab = () => {
  const { euiTheme } = useEuiTheme();
  const { page, perPage, setPage } = useEntityStorePocPagination();
  const [search, setSearch] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState<string | undefined>();
  const [showPromoteModal, setShowPromoteModal] = useState(false);

  const { data, isLoading, isError, refetch } = useFetchEntityStorePocEntities({
    page,
    perPage,
    search: search || undefined,
  });
  const installMutation = useInstallEntityStorePocMutation();

  const isInstalled = data?.installed ?? true;

  const columns: Array<EuiBasicTableColumn<EntityStorePocEntity>> = useMemo(
    () => [
      {
        field: 'name',
        name: i18n.translate('xpack.streams.entitiesTab.nameColumn', { defaultMessage: 'Name' }),
        render: (name: string, entity: EntityStorePocEntity) => (
          <EuiButtonEmpty
            size="s"
            flush="both"
            onClick={() => setSelectedEntityId(entity.id)}
            data-test-subj="entityStorePocEntityNameButton"
          >
            {name}
          </EuiButtonEmpty>
        ),
      },
      {
        field: 'type',
        name: i18n.translate('xpack.streams.entitiesTab.typeColumn', { defaultMessage: 'Type' }),
        width: '120px',
        render: (type: string) => <EuiBadge color="hollow">{type}</EuiBadge>,
      },
      {
        field: 'source',
        name: i18n.translate('xpack.streams.entitiesTab.sourceColumn', {
          defaultMessage: 'Source',
        }),
        render: (source: string[]) => {
          const isPromoted = source.some((entry) => entry.startsWith('significant_events:'));
          return (
            <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
              {isPromoted && (
                <EuiFlexItem grow={false}>
                  <EuiBadge color="accent" iconType="importAction">
                    {i18n.translate('xpack.streams.entitiesTab.promotedBadge', {
                      defaultMessage: 'Promoted from KI',
                    })}
                  </EuiBadge>
                </EuiFlexItem>
              )}
              {source
                .filter((entry) => !entry.startsWith('significant_events:'))
                .map((entry) => (
                  <EuiFlexItem grow={false} key={entry}>
                    <EuiBadge color="hollow">{entry}</EuiBadge>
                  </EuiFlexItem>
                ))}
            </EuiFlexGroup>
          );
        },
      },
      {
        field: 'lastSeen',
        name: i18n.translate('xpack.streams.entitiesTab.lastSeenColumn', {
          defaultMessage: 'Last seen',
        }),
        width: '200px',
        render: (lastSeen?: string) => (lastSeen ? formatTimestamp(lastSeen) : '—'),
      },
    ],
    []
  );

  const euiPagination = {
    pageIndex: page - 1,
    pageSize: perPage,
    totalItemCount: data?.total ?? 0,
    pageSizeOptions: [10, 25, 50],
  };

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      <EuiFlexItem grow={false}>
        <EuiCallOut size="s" color="warning" iconType="beaker" title={POC_BANNER_TITLE}>
          {POC_BANNER_BODY}
        </EuiCallOut>
      </EuiFlexItem>

      {!isInstalled && (
        <EuiFlexItem grow={false}>
          <EuiCallOut
            color="primary"
            iconType="iInCircle"
            title={NOT_INSTALLED_TITLE}
            data-test-subj="entityStorePocNotInstalledCallout"
          >
            <p>{NOT_INSTALLED_BODY}</p>
            <EuiButton
              size="s"
              isLoading={installMutation.isLoading}
              onClick={() => installMutation.mutate()}
              data-test-subj="entityStorePocInstallButton"
            >
              {INSTALL_BUTTON_LABEL}
            </EuiButton>
          </EuiCallOut>
        </EuiFlexItem>
      )}

      <EuiFlexItem grow={false}>
        <EuiFlexGroup justifyContent="spaceBetween" alignItems="center" wrap responsive={false}>
          <EuiFlexItem grow={false} css={{ minWidth: 280 }}>
            <EuiFieldSearch
              compressed
              placeholder={SEARCH_PLACEHOLDER}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onSearch={() => setPage(1)}
              data-test-subj="entityStorePocSearchInput"
            />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="s" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiToolTip content={REFRESH_LABEL}>
                  <EuiButtonIcon
                    iconType="refresh"
                    aria-label={REFRESH_LABEL}
                    onClick={() => refetch()}
                  />
                </EuiToolTip>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButton
                  size="s"
                  iconType="plusInCircle"
                  onClick={() => setShowPromoteModal(true)}
                  data-test-subj="entityStorePocPromoteKiButton"
                >
                  {PROMOTE_KI_BUTTON_LABEL}
                </EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>

      {isError && (
        <EuiFlexItem grow={false}>
          <EuiCallOut
            announceOnMount
            title={FETCH_ERROR_TITLE}
            color="danger"
            iconType="error"
            size="s"
          />
        </EuiFlexItem>
      )}

      <EuiFlexItem grow={false}>
        <EuiBasicTable
          css={css`
            & thead tr {
              background-color: ${euiTheme.colors.backgroundBaseSubdued};
            }
          `}
          tableCaption={i18n.translate('xpack.streams.entitiesTab.tableCaption', {
            defaultMessage: 'Entities',
          })}
          items={data?.records ?? []}
          itemId="id"
          columns={columns}
          pagination={euiPagination}
          onChange={({ page: nextPage }: { page?: { index: number; size: number } }) => {
            if (nextPage) setPage(nextPage.index + 1);
          }}
          loading={isLoading}
          noItemsMessage={i18n.translate('xpack.streams.entitiesTab.emptyBody', {
            defaultMessage: 'No entities found. Install the entity store, or sync some logs in.',
          })}
          rowProps={(entity: EntityStorePocEntity) => ({
            isSelected: selectedEntityId === entity.id,
          })}
        />
      </EuiFlexItem>

      {selectedEntityId && (
        <EntityFlyout entityId={selectedEntityId} onClose={() => setSelectedEntityId(undefined)} />
      )}
      {showPromoteModal && <PromoteKiModal onClose={() => setShowPromoteModal(false)} />}
    </EuiFlexGroup>
  );
};

const POC_BANNER_TITLE = i18n.translate('xpack.streams.entitiesTab.pocBannerTitle', {
  defaultMessage: 'Entity Store POC',
});
const POC_BANNER_BODY = i18n.translate('xpack.streams.entitiesTab.pocBannerBody', {
  defaultMessage:
    'This tab reads and writes the Security Entity Store (service entities only) through throwaway proxy routes, to test feasibility for Nightshift. Not a shipped feature.',
});
const NOT_INSTALLED_TITLE = i18n.translate('xpack.streams.entitiesTab.notInstalledTitle', {
  defaultMessage: 'Entity store not installed in this space',
});
const NOT_INSTALLED_BODY = i18n.translate('xpack.streams.entitiesTab.notInstalledBody', {
  defaultMessage:
    'Installs the "service" engine only, with logs-* added as an additional index pattern for log extraction.',
});
const INSTALL_BUTTON_LABEL = i18n.translate('xpack.streams.entitiesTab.installButton', {
  defaultMessage: 'Install entity store (service engine, logs-*)',
});
const SEARCH_PLACEHOLDER = i18n.translate('xpack.streams.entitiesTab.searchPlaceholder', {
  defaultMessage: 'Search by entity name',
});
const REFRESH_LABEL = i18n.translate('xpack.streams.entitiesTab.refreshLabel', {
  defaultMessage: 'Refresh',
});
const PROMOTE_KI_BUTTON_LABEL = i18n.translate('xpack.streams.entitiesTab.promoteKiButton', {
  defaultMessage: 'Promote KI to entity',
});
const FETCH_ERROR_TITLE = i18n.translate('xpack.streams.entitiesTab.fetchError', {
  defaultMessage: 'Failed to load entities',
});
