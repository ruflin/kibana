/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import {
  EuiButton,
  EuiEmptyPrompt,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLoadingSpinner,
  EuiCallOut,
  EuiLink,
  EuiSpacer,
} from '@elastic/eui';
import { FormattedMessage } from '@kbn/i18n-react';
import { i18n } from '@kbn/i18n';
import type { DocViewRenderProps } from '@kbn/unified-doc-viewer/types';
import { useDocumentAi } from './use_document_ai';
import { AiExplanation } from './ai_explanation';

export function DocViewerAi({ hit, dataView }: DocViewRenderProps) {
  const { isLoading, error, analysis, contextualSummary, explainDocument, hasEnterpriseLicense, isContextAnalysis } = useDocumentAi({
    hit,
    dataView,
  });

  // Show Enterprise license required message
  if (!hasEnterpriseLicense) {
    return (
      <EuiEmptyPrompt
        iconType="lock"
        title={
          <h2>
            <FormattedMessage
              id="xpack.unifiedDocViewerAi.docViewerAi.enterpriseLicenseRequired.title"
              defaultMessage="Enterprise license required"
            />
          </h2>
        }
        body={
          <p>
            <FormattedMessage
              id="xpack.unifiedDocViewerAi.docViewerAi.enterpriseLicenseRequired.description"
              defaultMessage="AI-powered document analysis requires an Enterprise license. {learnMore} about upgrading your license."
              values={{
                learnMore: (
                  <EuiLink
                    href="https://www.elastic.co/subscriptions"
                    target="_blank"
                    external
                  >
                    {i18n.translate(
                      'xpack.unifiedDocViewerAi.docViewerAi.enterpriseLicenseRequired.learnMore',
                      {
                        defaultMessage: 'Learn more',
                      }
                    )}
                  </EuiLink>
                ),
              }}
            />
          </p>
        }
      />
    );
  }

  // Show loading state - only full screen if no analysis exists yet
  if (isLoading && !analysis) {
    return (
      <EuiEmptyPrompt
        icon={<EuiLoadingSpinner size="xl" />}
        title={
          <h2>
            <FormattedMessage
              id="xpack.unifiedDocViewerAi.docViewerAi.analyzing.title"
              defaultMessage="Analyzing document..."
            />
          </h2>
        }
        body={
          <p>
            <FormattedMessage
              id="xpack.unifiedDocViewerAi.docViewerAi.analyzing.description"
              defaultMessage="The AI is analyzing your document. This may take a few moments."
            />
          </p>
        }
      />
    );
  }

  // Show error state - only full screen if no analysis exists
  if (error && !analysis) {
    return (
      <EuiFlexGroup direction="column" gutterSize="m">
        <EuiFlexItem>
          <EuiCallOut
            title={i18n.translate('xpack.unifiedDocViewerAi.docViewerAi.error.title', {
              defaultMessage: 'Failed to analyze document',
            })}
            color="danger"
            iconType="alert"
          >
            <p>{error.message}</p>
          </EuiCallOut>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiButton onClick={() => explainDocument(false)} fill>
            <FormattedMessage
              id="xpack.unifiedDocViewerAi.docViewerAi.error.retryButton"
              defaultMessage="Try again"
            />
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  // Show analysis results
  if (analysis) {
    const hasResources = analysis.resources && Object.keys(analysis.resources).length > 0;
    
    return (
      <EuiFlexGroup direction="column" gutterSize="m">
        <EuiFlexItem>
          <AiExplanation analysis={analysis} />
        </EuiFlexItem>
        
        {error && !contextualSummary && (
          <>
            <EuiFlexItem>
              <EuiSpacer size="m" />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiCallOut
                title={i18n.translate('xpack.unifiedDocViewerAi.docViewerAi.contextError.title', {
                  defaultMessage: 'Failed to analyze with surrounding events',
                })}
                color="danger"
                iconType="alert"
              >
                <p>{error.message}</p>
              </EuiCallOut>
            </EuiFlexItem>
          </>
        )}
        
        {isLoading && !contextualSummary && !error && (
          <>
            <EuiFlexItem>
              <EuiSpacer size="m" />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiCallOut
                title={i18n.translate('xpack.unifiedDocViewerAi.docViewerAi.analyzingContext.title', {
                  defaultMessage: 'Analyzing with surrounding events...',
                })}
                color="primary"
                iconType="clock"
              >
                <EuiFlexGroup alignItems="center" gutterSize="s">
                  <EuiFlexItem grow={false}>
                    <EuiLoadingSpinner size="m" />
                  </EuiFlexItem>
                  <EuiFlexItem>
                    <FormattedMessage
                      id="xpack.unifiedDocViewerAi.docViewerAi.analyzingContext.description"
                      defaultMessage="Fetching previous and next 5 events and re-analyzing with context..."
                    />
                  </EuiFlexItem>
                </EuiFlexGroup>
              </EuiCallOut>
            </EuiFlexItem>
          </>
        )}
        
        {contextualSummary && (
          <>
            <EuiFlexItem>
              <EuiSpacer size="m" />
            </EuiFlexItem>
            <EuiFlexItem>
              <AiExplanation 
                analysis={contextualSummary} 
                title={i18n.translate('xpack.unifiedDocViewerAi.docViewerAi.contextualSummaryTitle', {
                  defaultMessage: 'Summary with Surrounding Events',
                })}
              />
            </EuiFlexItem>
          </>
        )}
        
        <EuiFlexItem>
          <EuiFlexGroup gutterSize="s" wrap>
            <EuiFlexItem grow={false}>
              <EuiButton 
                onClick={() => explainDocument(false)} 
                iconType="refresh"
                isDisabled={isLoading}
              >
                <FormattedMessage
                  id="xpack.unifiedDocViewerAi.docViewerAi.reanalyzeButton"
                  defaultMessage="Re-analyze"
                />
              </EuiButton>
            </EuiFlexItem>
            {!contextualSummary && hasResources && (
              <EuiFlexItem grow={false}>
                <EuiButton
                  onClick={() => explainDocument(true)}
                  iconType="timeline"
                  color="primary"
                  isDisabled={isLoading}
                  isLoading={isLoading}
                >
                  <FormattedMessage
                    id="xpack.unifiedDocViewerAi.docViewerAi.analyzeWithContextButton"
                    defaultMessage="Analyze with Surrounding Events"
                  />
                </EuiButton>
              </EuiFlexItem>
            )}
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  // Show initial state with explain button
  return (
    <EuiEmptyPrompt
      iconType="bullseye"
      title={
        <h2>
          <FormattedMessage
            id="xpack.unifiedDocViewerAi.docViewerAi.initial.title"
            defaultMessage="AI Document Analysis"
          />
        </h2>
      }
      body={
        <>
          <p>
            <FormattedMessage
              id="xpack.unifiedDocViewerAi.docViewerAi.initial.description"
              defaultMessage="Use AI to analyze this document and get insights about its content, key fields, and significance."
            />
          </p>
          <EuiSpacer size="m" />
        </>
      }
      actions={
        <EuiButton onClick={() => explainDocument(false)} fill iconType="sparkles">
          <FormattedMessage
            id="xpack.unifiedDocViewerAi.docViewerAi.explainButton"
            defaultMessage="Explain with AI"
          />
        </EuiButton>
      }
    />
  );
}

