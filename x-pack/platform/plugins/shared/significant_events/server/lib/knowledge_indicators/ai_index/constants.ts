/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Context Engine catalog id for the Nightshift AI Index. */
export const NIGHTSHIFT_AI_INDEX_ID = 'nightshift';

/**
 * Index-backed dest so KIs upsert by stable id. Data streams are create-only
 * and cannot replace a KI on re-run.
 */
export const NIGHTSHIFT_AI_INDEX_DEST = 'ai-index-idx-nightshift';
