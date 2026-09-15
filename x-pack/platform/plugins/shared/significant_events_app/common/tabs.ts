/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const MANAGEMENT_TABS = [
  'data_sources',
  'knowledge_indicators',
  'significant_events',
  'memory',
  'settings',
] as const;

export type ManagementTab = (typeof MANAGEMENT_TABS)[number];

export const KI_SUBTABS = ['topology', 'queries', 'more'] as const;
export type KnowledgeIndicatorsSubtab = (typeof KI_SUBTABS)[number];

export const SIGNIFICANT_EVENTS_NESTED_SUBTABS = ['rules', 'detections'] as const;
export type SignificantEventsNestedSubtab = (typeof SIGNIFICANT_EVENTS_NESTED_SUBTABS)[number];

export const DEFAULT_MANAGEMENT_TAB: ManagementTab = 'data_sources';
export const DEFAULT_KI_SUBTAB: KnowledgeIndicatorsSubtab = 'topology';

export function isManagementTab(value: string): value is ManagementTab {
  return (MANAGEMENT_TABS as readonly string[]).includes(value);
}

export function isKiSubtab(value: string): value is KnowledgeIndicatorsSubtab {
  return (KI_SUBTABS as readonly string[]).includes(value);
}

export function isSignificantEventsNestedSubtab(
  value: string
): value is SignificantEventsNestedSubtab {
  return (SIGNIFICANT_EVENTS_NESTED_SUBTABS as readonly string[]).includes(value);
}

export interface CanonicalManagementLocation {
  tab: ManagementTab;
  subtab?: KnowledgeIndicatorsSubtab | SignificantEventsNestedSubtab;
  needsRedirect: boolean;
}

/**
 * Maps the current URL segments onto the IA, including legacy aliases
 * (`/streams`, `/queries`, `/detections`, `/discoveries`).
 */
export function resolveManagementLocation(
  tab: string,
  subtab?: string
): CanonicalManagementLocation {
  if (tab === 'streams') {
    return { tab: 'data_sources', needsRedirect: true };
  }
  if (tab === 'queries') {
    return { tab: 'significant_events', subtab: 'rules', needsRedirect: true };
  }
  if (tab === 'detections') {
    return { tab: 'significant_events', subtab: 'detections', needsRedirect: true };
  }
  if (tab === 'discoveries') {
    return { tab: 'significant_events', needsRedirect: true };
  }

  if (!isManagementTab(tab)) {
    return { tab: DEFAULT_MANAGEMENT_TAB, needsRedirect: true };
  }

  if (tab === 'knowledge_indicators') {
    if (!isKiSubtab(subtab ?? '')) {
      return { tab, subtab: DEFAULT_KI_SUBTAB, needsRedirect: true };
    }
    return { tab, subtab, needsRedirect: false };
  }

  if (tab === 'significant_events') {
    if (!subtab) {
      return { tab, needsRedirect: false };
    }
    if (subtab === 'events') {
      return { tab, needsRedirect: true };
    }
    if (isSignificantEventsNestedSubtab(subtab)) {
      return { tab, subtab, needsRedirect: false };
    }
    return { tab, needsRedirect: true };
  }

  if (subtab) {
    return { tab, needsRedirect: true };
  }

  return { tab, needsRedirect: false };
}

export function buildManagementPath({
  tab,
  subtab,
}: {
  tab: string;
  subtab?: string;
}): string {
  return subtab ? `/${tab}/${subtab}` : `/${tab}`;
}
