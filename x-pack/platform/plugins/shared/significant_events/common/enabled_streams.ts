/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Empty string means the allowlist has never been written (seed from onboarding status). */
export const ENABLED_STREAMS_SETTING_UNSET = '';

/** Upper bound for the persisted JSON allowlist (about 1k stream names). */
export const ENABLED_STREAMS_SETTING_MAX_LENGTH = 262_144;

export interface EnabledStreamsSetting {
  configured: boolean;
  streamNames: string[];
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * Parses the Nightshift Data Sources enabled-streams uiSetting.
 * Unset / blank means the allowlist has not been written yet.
 */
export const parseEnabledStreamsSetting = (
  rawValue: string | undefined
): EnabledStreamsSetting => {
  if (rawValue === undefined) {
    return { configured: false, streamNames: [] };
  }

  const trimmed = rawValue.trim();
  if (trimmed === '') {
    return { configured: false, streamNames: [] };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isStringArray(parsed)) {
      return {
        configured: true,
        streamNames: parsed.map((name) => name.trim()).filter((name) => name.length > 0),
      };
    }
  } catch {
    // Fall through to comma-separated names.
  }

  return {
    configured: true,
    streamNames: trimmed
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  };
};

/** Serializes an explicit allowlist. An empty array is configured-off, not unset. */
export const serializeEnabledStreamsSetting = (streamNames: readonly string[]): string =>
  JSON.stringify([...new Set(streamNames)].sort((a, b) => a.localeCompare(b)));
