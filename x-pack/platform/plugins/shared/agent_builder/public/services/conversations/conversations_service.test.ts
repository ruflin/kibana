/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { httpServiceMock } from '@kbn/core-http-browser-mocks';
import { ConversationsService } from './conversations_service';

describe('ConversationsService.list', () => {
  const buildService = () => {
    const http = httpServiceMock.createStartContract();
    http.get.mockResolvedValue({ results: [] });
    const service = new ConversationsService({ http });
    return { http, service };
  };

  // The `http.get` mock has overloads — to read both the path and options arguments
  // we cast each call to the [path, options] tuple shape.
  const lastCallArgs = (
    http: ReturnType<typeof httpServiceMock.createStartContract>
  ): [string, { query?: Record<string, unknown> } | undefined] =>
    http.get.mock.calls[0] as unknown as [string, { query?: Record<string, unknown> } | undefined];

  it('omits include_hidden when not requested (default behaviour preserved)', async () => {
    const { http, service } = buildService();

    await service.list({ agentId: 'agent-1' });

    expect(http.get).toHaveBeenCalledTimes(1);
    const [path, opts] = lastCallArgs(http);
    expect(path).toBe('/api/agent_builder/conversations');
    expect(opts?.query).toEqual({ agent_id: 'agent-1' });
    expect(opts?.query).not.toHaveProperty('include_hidden');
  });

  it('omits include_hidden when explicitly false', async () => {
    const { http, service } = buildService();

    await service.list({ agentId: 'agent-1', includeHidden: false });

    const [, opts] = lastCallArgs(http);
    expect(opts?.query).not.toHaveProperty('include_hidden');
  });

  it('forwards include_hidden=true on the query string when the toggle is on', async () => {
    const { http, service } = buildService();

    await service.list({ agentId: 'agent-1', includeHidden: true });

    const [, opts] = lastCallArgs(http);
    expect(opts?.query).toEqual({ agent_id: 'agent-1', include_hidden: true });
  });
});
