/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { HttpStart } from '@kbn/core/public';
import { EXPLAIN_DOCUMENT_API_ROUTE } from '../../common/constants';
import type {
  ExplainDocumentRequest,
  ExplainDocumentResponse,
} from '../../common/types';

export class UnifiedDocViewerAiApi {
  constructor(private readonly http: HttpStart) {}

  async explainDocument(
    document: Record<string, any>,
    dataViewId?: string
  ): Promise<ExplainDocumentResponse> {
    const body: ExplainDocumentRequest = {
      document,
      dataViewId,
    };

    const response = await this.http.post<ExplainDocumentResponse>(
      EXPLAIN_DOCUMENT_API_ROUTE,
      {
        body: JSON.stringify(body),
      }
    );

    return response;
  }
}

