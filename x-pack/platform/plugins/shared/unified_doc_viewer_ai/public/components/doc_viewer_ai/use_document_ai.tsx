/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useState, useCallback } from 'react';
import type { DataTableRecord } from '@kbn/discover-utils/types';
import type { DataView } from '@kbn/data-views-plugin/public';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { DocumentExplanation } from '../../../common/types';

export interface UseDocumentAiParams {
  hit: DataTableRecord;
  dataView: DataView;
}

export interface UseDocumentAiResult {
  isLoading: boolean;
  error: Error | null;
  analysis: DocumentExplanation | null;
  contextualSummary: DocumentExplanation | null;
  explainDocument: (includeContext?: boolean) => Promise<void>;
  hasEnterpriseLicense: boolean;
  isContextAnalysis: boolean;
}

interface UnifiedDocViewerAiServices {
  http: any;
  notifications: any;
}

/**
 * Create a strictly serializable payload for the document.
 * Prefer the Elasticsearch _source; fall back to flattened fields.
 */
function buildSerializableDocument(hit: DataTableRecord): Record<string, unknown> {
  const rawSource = hit.raw?._source as Record<string, unknown> | undefined;
  if (rawSource && typeof rawSource === 'object') {
    return rawSource;
  }
  // Fallback to flattened; ensure it's plain JSON (it should already be)
  return hit.flattened as Record<string, unknown>;
}

export function useDocumentAi({ hit, dataView }: UseDocumentAiParams): UseDocumentAiResult {
  const { services } = useKibana<UnifiedDocViewerAiServices>();
  const http = services?.http;
  const notifications = services?.notifications;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [analysis, setAnalysis] = useState<DocumentExplanation | null>(null);
  const [contextualSummary, setContextualSummary] = useState<DocumentExplanation | null>(null);
  const [isContextAnalysis, setIsContextAnalysis] = useState(false);

  // No license check - feature available to all
  const hasEnterpriseLicense = true;

  const explainDocument = useCallback(async (includeContext: boolean = false) => {
    if (!http) {
      const err = new Error('HTTP service not available');
      setError(err);
      return;
    }

    // Clear error state when starting a new analysis
    setError(null);
    setIsLoading(true);
    
    // Harden against incorrect callers passing an event or non-boolean
    const includeContextSafe = typeof includeContext === 'boolean' ? includeContext : false;
    setIsContextAnalysis(includeContextSafe);

    try {
      // Build a clean, serializable document payload
      const cleanDocument = buildSerializableDocument(hit);
      
      const response = await http.post('/internal/unified_doc_viewer_ai/explain_document', {
        body: JSON.stringify({
          document: cleanDocument,
          dataViewId: dataView.id,
          includeContext: includeContextSafe,
        }),
      });

      // If this is a contextual analysis, set it as contextualSummary
      // Otherwise, set it as the main analysis
      if (includeContextSafe) {
        setContextualSummary(response);
      } else {
        setAnalysis(response);
        // Clear contextual summary when doing a fresh analysis
        setContextualSummary(null);
      }
      
      if (notifications?.toasts) {
        notifications.toasts.addSuccess({
          title: includeContextSafe ? 'Contextual analysis complete' : 'Document analysis complete',
          text: includeContextSafe 
            ? 'The AI has analyzed the document with surrounding events.'
            : 'The AI has successfully analyzed the document.',
        });
      }
    } catch (err: any) {
      const errorMessage = err?.body?.message || err?.message || 'Unknown error occurred';
      const errorObj = new Error(errorMessage);
      setError(errorObj);
      
      if (notifications?.toasts) {
        notifications.toasts.addError(err, {
          title: 'Failed to analyze document',
          toastMessage: errorMessage,
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [hit, dataView.id, http, notifications]);

  return {
    isLoading,
    error,
    analysis,
    contextualSummary,
    explainDocument,
    hasEnterpriseLicense,
    isContextAnalysis,
  };
}

