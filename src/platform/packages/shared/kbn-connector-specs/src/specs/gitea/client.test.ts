/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ActionContext } from '../../connector_spec';
import { compact, encodeFilePath, getApiBase, repoPath, toPage } from './client';

const contextWith = (config: Record<string, unknown> | undefined) =>
  ({ config, client: {}, log: {} } as unknown as ActionContext);

describe('gitea client helpers', () => {
  describe('getApiBase', () => {
    it.each([
      ['https://gitea.example.com', 'https://gitea.example.com/api/v1'],
      ['https://gitea.example.com/', 'https://gitea.example.com/api/v1'],
      ['https://gitea.example.com///', 'https://gitea.example.com/api/v1'],
      ['https://gitea.example.com/api/v1', 'https://gitea.example.com/api/v1'],
      ['https://gitea.example.com/api/v1/', 'https://gitea.example.com/api/v1'],
      ['https://example.com/gitea', 'https://example.com/gitea/api/v1'],
      ['https://example.com/gitea/api/v1', 'https://example.com/gitea/api/v1'],
      ['http://localhost:3000', 'http://localhost:3000/api/v1'],
    ])('turns %s into %s', (baseUrl, expected) => {
      expect(getApiBase(contextWith({ baseUrl }))).toBe(expected);
    });

    it.each([[undefined], [{}], [{ baseUrl: '' }], [{ baseUrl: 42 }]])(
      'throws when the instance URL is missing (%j)',
      (config) => {
        expect(() => getApiBase(contextWith(config))).toThrow(
          'The Gitea instance URL is not configured'
        );
      }
    );
  });

  describe('repoPath', () => {
    it('encodes owner and repo as path segments', () => {
      expect(repoPath('elastic', 'kibana')).toBe('/repos/elastic/kibana');
      expect(repoPath('a/b', 'c?d#e')).toBe('/repos/a%2Fb/c%3Fd%23e');
    });
  });

  describe('encodeFilePath', () => {
    it('keeps separators and encodes each segment', () => {
      expect(encodeFilePath('src/index.ts')).toBe('src/index.ts');
      expect(encodeFilePath('docs/my file#1?.md')).toBe('docs/my%20file%231%3F.md');
      expect(encodeFilePath('ünï/čödé.txt')).toBe('%C3%BCn%C3%AF/%C4%8D%C3%B6d%C3%A9.txt');
    });
  });

  describe('compact', () => {
    it('drops undefined values and keeps false, zero and empty strings', () => {
      expect(compact({ a: undefined, b: false, c: 0, d: '', e: 'x' })).toEqual({
        b: false,
        c: 0,
        d: '',
        e: 'x',
      });
    });
  });

  describe('toPage', () => {
    const paging = { page: 2, limit: 10 };

    it('reads the total from X-Total-Count', () => {
      expect(toPage([1], { headers: { 'x-total-count': '45' } }, paging)).toEqual({
        values: [1],
        page: 2,
        limit: 10,
        total: 45,
        hasMore: true,
      });
    });

    it('reports no more pages on the last page', () => {
      expect(toPage([1], { headers: { 'x-total-count': '20' } }, paging).hasMore).toBe(false);
    });

    it('detects a next page from the Link header when the total is unknown', () => {
      const result = toPage(
        [1],
        { headers: { link: '<https://gitea.example.com/api/v1/x?page=3>; rel="next"' } },
        paging
      );
      expect(result.total).toBeNull();
      expect(result.hasMore).toBe(true);
    });

    it('does not treat rel="prev" or rel="last" links as a next page', () => {
      const result = toPage(
        [1],
        { headers: { link: '<https://h/x?page=1>; rel="prev",<https://h/x?page=2>; rel="first"' } },
        paging
      );
      expect(result.hasMore).toBe(false);
    });

    it('honors X-HasMore', () => {
      expect(toPage([], { headers: { 'x-hasmore': 'true' } }, paging).hasMore).toBe(true);
      expect(toPage([], { headers: { 'x-hasmore': 'false' } }, paging).hasMore).toBe(false);
    });

    it('prefers an explicit total from the response body', () => {
      expect(toPage([1], { headers: {} }, paging, 100)).toMatchObject({
        total: 100,
        hasMore: true,
      });
    });

    it('reports an unknown total as null, not NaN', () => {
      expect(toPage([], { headers: { 'x-total-count': 'abc' } }, paging).total).toBeNull();
      expect(toPage([], {}, paging).total).toBeNull();
    });
  });
});
