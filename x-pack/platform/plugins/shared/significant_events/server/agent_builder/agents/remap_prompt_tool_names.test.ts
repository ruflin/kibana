/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { remapPromptToolNames } from './remap_prompt_tool_names';

describe('remapPromptToolNames', () => {
  it('replaces prompt-local tool names with Agent Builder ids', () => {
    const remapped = remapPromptToolNames('Call get_stream_features then add_queries', [
      ['get_stream_features', 'platform.sig_events.ki_search'],
      ['add_queries', 'platform.sig_events.ki_query_validate'],
    ]);

    expect(remapped).toBe(
      'Call platform.sig_events.ki_search then platform.sig_events.ki_query_validate'
    );
  });

  it('applies longer names first', () => {
    const remapped = remapPromptToolNames('finalize_features and finalize', [
      ['finalize', 'short'],
      ['finalize_features', 'long'],
    ]);

    expect(remapped).toBe('long and short');
  });
});
