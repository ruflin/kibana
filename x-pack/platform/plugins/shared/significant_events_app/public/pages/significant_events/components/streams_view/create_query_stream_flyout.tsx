/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiButton,
  EuiButtonEmpty,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiForm,
  EuiFormRow,
  EuiSpacer,
  EuiText,
  EuiTextArea,
  EuiTitle,
} from '@elastic/eui';
import { useQueryClient } from '@kbn/react-query';
import React, { useCallback, useState } from 'react';
import { useKibana } from '../../../../hooks/use_kibana';
import { STREAM_LIST_QUERY_KEY } from '../../hooks/use_fetch_streams';
import { getFormattedError } from '../../../../util/errors';
import {
  CREATE_QUERY_STREAM_CANCEL_LABEL,
  CREATE_QUERY_STREAM_DESCRIPTION,
  CREATE_QUERY_STREAM_ERROR_TITLE,
  CREATE_QUERY_STREAM_FLYOUT_TITLE,
  CREATE_QUERY_STREAM_NAME_LABEL,
  CREATE_QUERY_STREAM_NAME_REQUIRED,
  CREATE_QUERY_STREAM_QUERY_LABEL,
  CREATE_QUERY_STREAM_QUERY_REQUIRED,
  CREATE_QUERY_STREAM_SAVE_LABEL,
  CREATE_QUERY_STREAM_SUCCESS_TITLE,
} from './translations';

const NAME_MAX_LENGTH = 255;
const QUERY_MAX_LENGTH = 10_000;

interface CreateQueryStreamFlyoutProps {
  onClose: () => void;
}

export function CreateQueryStreamFlyout({ onClose }: CreateQueryStreamFlyoutProps) {
  const {
    core: {
      notifications: { toasts },
    },
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [esqlQuery, setEsqlQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const trimmedName = name.trim();
  const trimmedQuery = esqlQuery.trim();
  const nameError = submitted && !trimmedName ? CREATE_QUERY_STREAM_NAME_REQUIRED : undefined;
  const queryError = submitted && !trimmedQuery ? CREATE_QUERY_STREAM_QUERY_REQUIRED : undefined;

  const handleSubmit = useCallback(async () => {
    setSubmitted(true);
    if (!trimmedName || !trimmedQuery) {
      return;
    }

    setIsSubmitting(true);
    try {
      await streamsRepositoryClient.fetch('PUT /api/streams/{name}/_query 2023-10-31', {
        params: {
          path: { name: trimmedName },
          body: { query: { esql: trimmedQuery } },
        },
        signal: null,
      });
      await queryClient.invalidateQueries({ queryKey: STREAM_LIST_QUERY_KEY });
      toasts.addSuccess({
        title: CREATE_QUERY_STREAM_SUCCESS_TITLE,
        toastLifeTimeMs: 3000,
      });
      onClose();
    } catch (error) {
      toasts.addDanger({
        title: CREATE_QUERY_STREAM_ERROR_TITLE,
        text: getFormattedError(error).message,
        toastLifeTimeMs: 3000,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [onClose, queryClient, streamsRepositoryClient, toasts, trimmedName, trimmedQuery]);

  return (
    <EuiFlyout
      size="m"
      onClose={onClose}
      ownFocus
      aria-labelledby="significantEventsCreateQueryStreamFlyoutTitle"
      data-test-subj="significantEventsCreateQueryStreamFlyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle>
          <h2 id="significantEventsCreateQueryStreamFlyoutTitle">
            {CREATE_QUERY_STREAM_FLYOUT_TITLE}
          </h2>
        </EuiTitle>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiText size="s">
          <p>{CREATE_QUERY_STREAM_DESCRIPTION}</p>
        </EuiText>
        <EuiSpacer size="m" />
        <EuiForm component="form" onSubmit={(event) => event.preventDefault()}>
          <EuiFormRow
            label={CREATE_QUERY_STREAM_NAME_LABEL}
            isInvalid={Boolean(nameError)}
            error={nameError}
          >
            <EuiFieldText
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={NAME_MAX_LENGTH}
              isInvalid={Boolean(nameError)}
              data-test-subj="significantEventsCreateQueryStreamName"
            />
          </EuiFormRow>
          <EuiFormRow
            label={CREATE_QUERY_STREAM_QUERY_LABEL}
            isInvalid={Boolean(queryError)}
            error={queryError}
          >
            <EuiTextArea
              value={esqlQuery}
              onChange={(event) => setEsqlQuery(event.target.value)}
              maxLength={QUERY_MAX_LENGTH}
              rows={8}
              isInvalid={Boolean(queryError)}
              data-test-subj="significantEventsCreateQueryStreamQuery"
            />
          </EuiFormRow>
        </EuiForm>
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween">
          <EuiButtonEmpty
            onClick={onClose}
            flush="left"
            data-test-subj="significantEventsCreateQueryStreamCancel"
          >
            {CREATE_QUERY_STREAM_CANCEL_LABEL}
          </EuiButtonEmpty>
          <EuiButton
            fill
            onClick={() => {
              void handleSubmit();
            }}
            isLoading={isSubmitting}
            data-test-subj="significantEventsCreateQueryStreamSave"
          >
            {CREATE_QUERY_STREAM_SAVE_LABEL}
          </EuiButton>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
}
