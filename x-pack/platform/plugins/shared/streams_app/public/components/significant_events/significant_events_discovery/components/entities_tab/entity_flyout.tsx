/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useState } from 'react';
import {
  EuiBadge,
  EuiButton,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiDescriptionList,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiFormRow,
  EuiHorizontalRule,
  EuiLink,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiSuperSelect,
  EuiText,
  EuiTitle,
  EuiToolTip,
  useGeneratedHtmlId,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { FlyoutToolbarHeader } from '../../../../flyout_components/flyout_toolbar_header';
import { InfoPanel } from '../../../../info_panel';
import { formatTimestamp } from '../../../../../util/formatters';
import { useKibana } from '../../../../../hooks/use_kibana';
import {
  useAssertRelationshipMutation,
  useAttachDashboardMutation,
  useFetchEntityStorePocDashboards,
  useFetchEntityStorePocEntity,
  type EntityStorePocRelationshipKind,
} from './use_entity_store_poc';

const RELATIONSHIP_KIND_OPTIONS: Array<{ value: EntityStorePocRelationshipKind; text: string }> = [
  'depends_on',
  'communicates_with',
  'owns',
  'owns_inferred',
  'administers',
  'supervises',
  'accesses_frequently',
  'accesses_infrequently',
].map((kind) => ({ value: kind as EntityStorePocRelationshipKind, text: kind }));

interface EntityFlyoutProps {
  entityId: string;
  onClose: () => void;
}

export const EntityFlyout = ({ entityId, onClose }: EntityFlyoutProps) => {
  const flyoutTitleId = useGeneratedHtmlId({ prefix: 'entityStorePocFlyoutTitle' });
  const { data, isLoading } = useFetchEntityStorePocEntity(entityId);
  const entity = data?.entity;
  const attachments = data?.attachments ?? [];

  const {
    core: {
      application: { getUrlForApp },
    },
  } = useKibana();

  return (
    <EuiFlyout
      onClose={onClose}
      aria-labelledby={flyoutTitleId}
      type="push"
      ownFocus={false}
      size="40%"
      hideCloseButton
      data-test-subj="entityStorePocFlyout"
    >
      <FlyoutToolbarHeader>
        <EuiFlexItem grow={false}>
          <EuiToolTip content={CLOSE_LABEL} disableScreenReaderOutput>
            <EuiButtonIcon
              data-test-subj="entityStorePocFlyoutCloseButton"
              iconType="cross"
              aria-label={CLOSE_LABEL}
              onClick={onClose}
            />
          </EuiToolTip>
        </EuiFlexItem>
      </FlyoutToolbarHeader>

      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s">
          <h2 id={flyoutTitleId}>{entity?.name ?? entityId}</h2>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiText size="s" color="subdued">
          {entityId}
        </EuiText>
      </EuiFlyoutHeader>

      <EuiFlyoutBody>
        {isLoading ? (
          <EuiLoadingSpinner size="m" />
        ) : !entity ? (
          <EuiText size="s" color="subdued">
            {i18n.translate('xpack.streams.entitiesTab.flyout.notFound', {
              defaultMessage: 'This entity could not be loaded.',
            })}
          </EuiText>
        ) : (
          <>
            <InfoPanel title={GENERAL_INFO_TITLE}>
              <EuiDescriptionList
                type="column"
                columnWidths={[1, 2]}
                compressed
                listItems={[
                  { title: TYPE_LABEL, description: <EuiBadge color="hollow">{entity.type}</EuiBadge> },
                  {
                    title: SOURCE_LABEL,
                    description: (
                      <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
                        {entity.source.length === 0 ? (
                          <EuiText size="s" color="subdued">
                            —
                          </EuiText>
                        ) : (
                          entity.source.map((source) => (
                            <EuiFlexItem grow={false} key={source}>
                              <EuiBadge color="hollow">{source}</EuiBadge>
                            </EuiFlexItem>
                          ))
                        )}
                      </EuiFlexGroup>
                    ),
                  },
                  {
                    title: FIRST_SEEN_LABEL,
                    description: entity.firstSeen ? formatTimestamp(entity.firstSeen) : '—',
                  },
                  {
                    title: LAST_SEEN_LABEL,
                    description: entity.lastSeen ? formatTimestamp(entity.lastSeen) : '—',
                  },
                  {
                    title: URL_LABEL,
                    description: entity.url ? (
                      <EuiLink href={entity.url} target="_blank">
                        {entity.url}
                      </EuiLink>
                    ) : (
                      '—'
                    ),
                  },
                ]}
              />
            </InfoPanel>

            <EuiSpacer size="l" />
            <RelationshipsSection entityId={entity.id} relationships={entity.relationships} />

            <EuiSpacer size="l" />
            <AttachmentsSection
              entityId={entity.id}
              attachments={attachments}
              getUrlForApp={getUrlForApp}
            />
          </>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};

const RelationshipsSection = ({
  entityId,
  relationships,
}: {
  entityId: string;
  relationships: Array<{ kind: string; targetEntityId: string; targetServiceName?: string }>;
}) => {
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<EntityStorePocRelationshipKind>('depends_on');
  const [targetServiceName, setTargetServiceName] = useState('');
  const mutation = useAssertRelationshipMutation(entityId);

  return (
    <EuiPanel hasShadow={false} hasBorder paddingSize="m">
      <EuiFlexGroup justifyContent="spaceBetween" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiTitle size="xs">
            <h3>{RELATIONSHIPS_TITLE}</h3>
          </EuiTitle>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            size="xs"
            iconType={showForm ? 'minusInCircle' : 'plusInCircle'}
            onClick={() => setShowForm((prev) => !prev)}
            data-test-subj="entityStorePocAddRelationshipToggle"
          >
            {ADD_RELATIONSHIP_LABEL}
          </EuiButtonEmpty>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />

      {relationships.length === 0 ? (
        <EuiText size="s" color="subdued">
          {NO_RELATIONSHIPS_LABEL}
        </EuiText>
      ) : (
        relationships.map((relationship, index) => (
          <React.Fragment key={`${relationship.kind}-${relationship.targetEntityId}`}>
            <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiBadge color="primary">{relationship.kind}</EuiBadge>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiText size="s">
                  {relationship.targetServiceName ?? relationship.targetEntityId}
                </EuiText>
              </EuiFlexItem>
            </EuiFlexGroup>
            {index < relationships.length - 1 && <EuiSpacer size="xs" />}
          </React.Fragment>
        ))
      )}

      {showForm && (
        <>
          <EuiHorizontalRule margin="s" />
          <EuiFormRow label={KIND_LABEL} display="rowCompressed">
            <EuiSelect
              compressed
              options={RELATIONSHIP_KIND_OPTIONS}
              value={kind}
              onChange={(e) => setKind(e.target.value as EntityStorePocRelationshipKind)}
              data-test-subj="entityStorePocRelationshipKindSelect"
            />
          </EuiFormRow>
          <EuiFormRow label={TARGET_SERVICE_LABEL} display="rowCompressed">
            <EuiFieldText
              compressed
              value={targetServiceName}
              onChange={(e) => setTargetServiceName(e.target.value)}
              placeholder="e.g. billing-service"
              data-test-subj="entityStorePocRelationshipTargetInput"
            />
          </EuiFormRow>
          <EuiSpacer size="s" />
          <EuiButton
            size="s"
            fill
            isLoading={mutation.isLoading}
            isDisabled={!targetServiceName}
            data-test-subj="entityStorePocAssertRelationshipButton"
            onClick={() => {
              mutation.mutate(
                { kind, targetServiceName },
                { onSuccess: () => setShowForm(false) }
              );
            }}
          >
            {ASSERT_RELATIONSHIP_LABEL}
          </EuiButton>
        </>
      )}
    </EuiPanel>
  );
};

const AttachmentsSection = ({
  entityId,
  attachments,
  getUrlForApp,
}: {
  entityId: string;
  attachments: Array<{
    id: string;
    dashboardId: string;
    dashboardTitle: string;
    createdBy?: string;
    createdAt: string;
  }>;
  getUrlForApp: (app: string, options?: { path?: string }) => string;
}) => {
  const [showForm, setShowForm] = useState(false);
  const [dashboardId, setDashboardId] = useState<string | undefined>();
  const { data: dashboardsData, isLoading: isDashboardsLoading } =
    useFetchEntityStorePocDashboards();
  const mutation = useAttachDashboardMutation(entityId);
  const dashboards = dashboardsData?.dashboards ?? [];

  return (
    <EuiPanel hasShadow={false} hasBorder paddingSize="m">
      <EuiFlexGroup justifyContent="spaceBetween" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiTitle size="xs">
            <h3>{ATTACHMENTS_TITLE}</h3>
          </EuiTitle>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            size="xs"
            iconType={showForm ? 'minusInCircle' : 'plusInCircle'}
            onClick={() => setShowForm((prev) => !prev)}
            data-test-subj="entityStorePocAddAttachmentToggle"
          >
            {ADD_ATTACHMENT_LABEL}
          </EuiButtonEmpty>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />

      {attachments.length === 0 ? (
        <EuiText size="s" color="subdued">
          {NO_ATTACHMENTS_LABEL}
        </EuiText>
      ) : (
        attachments.map((attachment) => (
          <EuiFlexGroup key={attachment.id} gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiBadge iconType="dashboardApp" color="hollow">
                {i18n.translate('xpack.streams.entitiesTab.flyout.dashboardBadge', {
                  defaultMessage: 'Dashboard',
                })}
              </EuiBadge>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiLink
                href={getUrlForApp('dashboards', { path: `#/view/${attachment.dashboardId}` })}
                target="_blank"
              >
                {attachment.dashboardTitle}
              </EuiLink>
              <EuiText size="xs" color="subdued">
                {i18n.translate('xpack.streams.entitiesTab.flyout.attachmentProvenance', {
                  defaultMessage: 'Attached by {createdBy} on {createdAt}',
                  values: {
                    createdBy: attachment.createdBy ?? 'unknown',
                    createdAt: formatTimestamp(attachment.createdAt),
                  },
                })}
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        ))
      )}

      {showForm && (
        <>
          <EuiHorizontalRule margin="s" />
          <EuiFormRow label={DASHBOARD_LABEL} display="rowCompressed">
            <EuiSuperSelect
              compressed
              isLoading={isDashboardsLoading}
              options={dashboards.map((dashboard) => ({
                value: dashboard.id,
                inputDisplay: dashboard.title,
              }))}
              valueOfSelected={dashboardId}
              onChange={(value) => setDashboardId(value)}
              data-test-subj="entityStorePocDashboardSelect"
            />
          </EuiFormRow>
          <EuiSpacer size="s" />
          <EuiButton
            size="s"
            fill
            isLoading={mutation.isLoading}
            isDisabled={!dashboardId}
            data-test-subj="entityStorePocAttachDashboardButton"
            onClick={() => {
              const dashboard = dashboards.find((item) => item.id === dashboardId);
              if (!dashboard) return;
              mutation.mutate(
                { dashboardId: dashboard.id, dashboardTitle: dashboard.title },
                { onSuccess: () => setShowForm(false) }
              );
            }}
          >
            {ATTACH_DASHBOARD_LABEL}
          </EuiButton>
        </>
      )}
    </EuiPanel>
  );
};

const CLOSE_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.closeAriaLabel', {
  defaultMessage: 'Close',
});
const GENERAL_INFO_TITLE = i18n.translate('xpack.streams.entitiesTab.flyout.generalInfoTitle', {
  defaultMessage: 'General information',
});
const TYPE_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.typeLabel', {
  defaultMessage: 'Type',
});
const SOURCE_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.sourceLabel', {
  defaultMessage: 'Source',
});
const FIRST_SEEN_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.firstSeenLabel', {
  defaultMessage: 'First seen',
});
const LAST_SEEN_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.lastSeenLabel', {
  defaultMessage: 'Last seen',
});
const URL_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.urlLabel', {
  defaultMessage: 'URL (entity.url — used by the POC attachment hack)',
});
const RELATIONSHIPS_TITLE = i18n.translate('xpack.streams.entitiesTab.flyout.relationshipsTitle', {
  defaultMessage: 'Relationships',
});
const NO_RELATIONSHIPS_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.noRelationships', {
  defaultMessage: 'No relationships asserted yet.',
});
const ADD_RELATIONSHIP_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.addRelationship', {
  defaultMessage: 'Add relationship',
});
const KIND_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.kindLabel', {
  defaultMessage: 'Kind',
});
const TARGET_SERVICE_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.targetServiceLabel', {
  defaultMessage: 'Target service name',
});
const ASSERT_RELATIONSHIP_LABEL = i18n.translate(
  'xpack.streams.entitiesTab.flyout.assertRelationship',
  { defaultMessage: 'Assert relationship' }
);
const ATTACHMENTS_TITLE = i18n.translate('xpack.streams.entitiesTab.flyout.attachmentsTitle', {
  defaultMessage: 'Attachments',
});
const NO_ATTACHMENTS_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.noAttachments', {
  defaultMessage: 'No attachments yet.',
});
const ADD_ATTACHMENT_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.addAttachment', {
  defaultMessage: 'Attach dashboard',
});
const DASHBOARD_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.dashboardLabel', {
  defaultMessage: 'Dashboard',
});
const ATTACH_DASHBOARD_LABEL = i18n.translate('xpack.streams.entitiesTab.flyout.attachDashboard', {
  defaultMessage: 'Attach',
});
