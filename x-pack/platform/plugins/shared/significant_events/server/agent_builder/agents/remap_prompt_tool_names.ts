/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Replaces prompt-local tool names with Agent Builder tool ids.
 * Longer `from` strings are applied first so overlapping names do not partial-match.
 */
export const remapPromptToolNames = (
  prompt: string,
  renames: ReadonlyArray<readonly [from: string, to: string]>
): string => {
  return [...renames]
    .sort((left, right) => right[0].length - left[0].length)
    .reduce((text, [from, to]) => text.split(from).join(to), prompt);
};
