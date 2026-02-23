/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Single correlated feature hit from semantic search. */
export interface CorrelatedFeatureHit {
  id: string;
  stream_name: string;
  title: string;
  type: string;
  subtype?: string;
  description: string;
  score?: number;
}

/** Single correlated query hit from semantic search (assets index). */
export interface CorrelatedQueryHit {
  asset_id: string;
  stream_name: string;
  title: string;
  kql_body: string;
  score?: number;
}

/** Response of the semantic correlation API. */
export interface SemanticCorrelateResponse {
  features: CorrelatedFeatureHit[];
  queries?: CorrelatedQueryHit[];
}
