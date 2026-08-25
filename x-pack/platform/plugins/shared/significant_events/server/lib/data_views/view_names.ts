/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ESQL_VIEW_PREFIX } from '@kbn/streams-schema';

const OWNED_VIEW_NAMESPACE = 'nightshift';

const VIEW_NAME_SLUG = /[^a-zA-Z0-9._-]+/g;

export const SYSTEM_ESQL_VIEW_NAMES = new Set([
  '$.rule-events',
  '$.alert-actions',
  '$.alert-episodes',
]);

export const isSystemEsqlView = (name: string): boolean => SYSTEM_ESQL_VIEW_NAMES.has(name);

export const sanitizeViewSlug = (value: string): string =>
  value
    .trim()
    .replace(VIEW_NAME_SLUG, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Names owned views as `$.nightshift.{spaceId}.{id}` so they do not shadow data
 * streams and stay unique across spaces.
 */
export const toOwnedViewName = ({ id, spaceId }: { id: string; spaceId: string }): string => {
  const unprefixed = id.trim().startsWith(ESQL_VIEW_PREFIX)
    ? id.trim().slice(ESQL_VIEW_PREFIX.length)
    : id.trim();
  const slug = sanitizeViewSlug(unprefixed);
  const spaceSlug = sanitizeViewSlug(spaceId) || 'default';
  if (!slug) {
    throw new Error('View name is required');
  }
  return `${ESQL_VIEW_PREFIX}${OWNED_VIEW_NAMESPACE}.${spaceSlug}.${slug}`;
};
