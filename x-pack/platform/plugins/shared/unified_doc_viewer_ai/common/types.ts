/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export interface DocumentExplanation {
  title: string;
  summary: string;
  description: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  proposedFix?: string;
  resources: {
    service?: string;
    host?: string;
    container?: string;
    namespace?: string;
    cluster?: string;
    [key: string]: string | undefined;
  };
}

export interface ExplainDocumentRequest {
  document: Record<string, any>;
  dataViewId?: string;
  includeContext?: boolean;
}

export interface ExplainDocumentResponse {
  title: string;
  summary: string;
  description: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  proposedFix?: string;
  resources: {
    service?: string;
    host?: string;
    container?: string;
    namespace?: string;
    cluster?: string;
    [key: string]: string | undefined;
  };
}

