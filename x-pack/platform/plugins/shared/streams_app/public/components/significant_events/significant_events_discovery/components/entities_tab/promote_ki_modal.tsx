/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo, useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFieldText,
  EuiForm,
  EuiFormRow,
  EuiModal,
  EuiModalBody,
  EuiModalFooter,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiSpacer,
  EuiSuperSelect,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { useFetchEligibleKis, usePromoteEntityMutation } from './use_entity_store_poc';

interface PromoteKiModalProps {
  onClose: () => void;
}

/**
 * Item 3 of the POC: promotes a Knowledge Indicator of type `entity` into a first-class
 * store entity via the CRUD API. The KI's title is offered as a starting point for the
 * service name because that's what the "Entity" KI type carries, but it is left editable
 * since a KI title is a free-text label, not guaranteed to match `service.name` exactly.
 */
export const PromoteKiModal = ({ onClose }: PromoteKiModalProps) => {
  const { data, isLoading } = useFetchEligibleKis();
  const mutation = usePromoteEntityMutation();
  const features = data?.features ?? [];

  const [selectedFeatureId, setSelectedFeatureId] = useState<string | undefined>();
  const selectedFeature = useMemo(
    () => features.find((feature) => feature.id === selectedFeatureId),
    [features, selectedFeatureId]
  );
  const [serviceName, setServiceName] = useState('');

  return (
    <EuiModal onClose={onClose} data-test-subj="entityStorePocPromoteKiModal">
      <EuiModalHeader>
        <EuiModalHeaderTitle>{TITLE}</EuiModalHeaderTitle>
      </EuiModalHeader>
      <EuiModalBody>
        <EuiCallOut size="s" color="warning" iconType="beaker" title={POC_CALLOUT_TITLE}>
          {POC_CALLOUT_BODY}
        </EuiCallOut>
        <EuiSpacer size="m" />
        <EuiForm component="div">
          <EuiFormRow label={KI_LABEL} helpText={features.length === 0 && !isLoading ? NO_KIS_HELP : undefined}>
            <EuiSuperSelect
              isLoading={isLoading}
              options={features.map((feature) => ({
                value: feature.id,
                inputDisplay: `${feature.title} (${feature.streamName})`,
              }))}
              valueOfSelected={selectedFeatureId}
              onChange={(value) => {
                setSelectedFeatureId(value);
                const feature = features.find((item) => item.id === value);
                if (feature && !serviceName) {
                  setServiceName(feature.title);
                }
              }}
              data-test-subj="entityStorePocEligibleKiSelect"
            />
          </EuiFormRow>
          <EuiFormRow label={SERVICE_NAME_LABEL}>
            <EuiFieldText
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="e.g. billing-service"
              data-test-subj="entityStorePocPromoteServiceNameInput"
            />
          </EuiFormRow>
        </EuiForm>
      </EuiModalBody>
      <EuiModalFooter>
        <EuiButtonEmpty onClick={onClose}>{CANCEL_LABEL}</EuiButtonEmpty>
        <EuiButton
          fill
          isLoading={mutation.isLoading}
          isDisabled={!selectedFeature || !serviceName}
          data-test-subj="entityStorePocPromoteSubmitButton"
          onClick={() => {
            if (!selectedFeature) return;
            mutation.mutate(
              {
                serviceName,
                sourceKiId: selectedFeature.id,
                sourceStreamName: selectedFeature.streamName,
              },
              { onSuccess: onClose }
            );
          }}
        >
          {PROMOTE_LABEL}
        </EuiButton>
      </EuiModalFooter>
    </EuiModal>
  );
};

const TITLE = i18n.translate('xpack.streams.entitiesTab.promoteModal.title', {
  defaultMessage: 'Promote a Knowledge Indicator to an entity',
});
const POC_CALLOUT_TITLE = i18n.translate('xpack.streams.entitiesTab.promoteModal.calloutTitle', {
  defaultMessage: 'Entity Store POC',
});
const POC_CALLOUT_BODY = i18n.translate('xpack.streams.entitiesTab.promoteModal.calloutBody', {
  defaultMessage:
    'Writes a new "service" entity through the Entity Store CRUD API, tagged with the source KI. This is manual, one entity at a time — not an automated promotion loop.',
});
const KI_LABEL = i18n.translate('xpack.streams.entitiesTab.promoteModal.kiLabel', {
  defaultMessage: 'Knowledge Indicator (type: entity)',
});
const NO_KIS_HELP = i18n.translate('xpack.streams.entitiesTab.promoteModal.noKisHelp', {
  defaultMessage: 'No entity-type Knowledge Indicators found across any onboarded stream.',
});
const SERVICE_NAME_LABEL = i18n.translate('xpack.streams.entitiesTab.promoteModal.serviceName', {
  defaultMessage: 'service.name to promote as',
});
const CANCEL_LABEL = i18n.translate('xpack.streams.entitiesTab.promoteModal.cancel', {
  defaultMessage: 'Cancel',
});
const PROMOTE_LABEL = i18n.translate('xpack.streams.entitiesTab.promoteModal.promote', {
  defaultMessage: 'Promote',
});
