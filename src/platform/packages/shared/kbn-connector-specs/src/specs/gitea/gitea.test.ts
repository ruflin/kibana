/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ActionContext } from '../../connector_spec';
import { Gitea } from './gitea';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();

const BASE = 'https://gitea.example.com/api/v1';
const REPO = `${BASE}/repos/elastic/kibana`;

const mockContext = {
  client: { get: mockGet, post: mockPost, patch: mockPatch },
  log: {},
  config: { baseUrl: 'https://gitea.example.com' },
} as unknown as ActionContext;

type ActionName = keyof typeof Gitea.actions;

/** Parse raw input through the action's Zod schema so defaults are applied, as the executor does. */
const parse = (action: ActionName, raw: Record<string, unknown>) =>
  Gitea.actions[action].input.parse(raw);

/** Parse the raw input, then run the handler against the mocked client. */
const run = async (action: ActionName, raw: Record<string, unknown>) =>
  Gitea.actions[action].handler(mockContext, parse(action, raw));

const repoArgs = { owner: 'elastic', repo: 'kibana' };

const listResponse = (data: unknown, headers: Record<string, string> = {}) => ({ data, headers });

describe('Gitea connector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(listResponse([]));
    mockPost.mockResolvedValue({ data: {} });
    mockPatch.mockResolvedValue({ data: {} });
  });

  describe('metadata and config', () => {
    it('has the correct id and ships to Agent Builder only', () => {
      expect(Gitea.metadata.id).toBe('.gitea');
      expect(Gitea.metadata.supportedFeatureIds).toEqual(['agentBuilder']);
      expect(Gitea.metadata.minimumLicense).toBe('enterprise');
    });

    it('offers a single bearer token auth type whose help text lists every scope', () => {
      expect(Gitea.auth?.types).toHaveLength(1);
      const [bearer] = Gitea.auth?.types ?? [];
      expect(bearer).toMatchObject({ type: 'bearer', supportsSandbox: true });
      const helpText = JSON.stringify(bearer);
      for (const scope of [
        'read:user',
        'read:repository',
        'read:issue',
        'write:issue',
        'write:repository',
      ]) {
        expect(helpText).toContain(scope);
      }
    });

    it('validates the instance URL', () => {
      expect(Gitea.validateUrls?.fields).toEqual(['baseUrl']);
      const schema = Gitea.schema;
      expect(schema?.safeParse({ baseUrl: 'https://gitea.example.com' }).success).toBe(true);
      expect(schema?.safeParse({ baseUrl: 'not a url' }).success).toBe(false);
      expect(schema?.safeParse({}).success).toBe(false);
    });
  });

  describe('action contract', () => {
    const expectedScopes: Record<string, 'read' | 'write' | 'destroy'> = {
      getCurrentUser: 'read',
      searchRepositories: 'read',
      getRepository: 'read',
      searchUsers: 'read',
      listIssues: 'read',
      getIssue: 'read',
      listIssueComments: 'read',
      listLabels: 'read',
      listPullRequests: 'read',
      getPullRequest: 'read',
      listPullRequestFiles: 'read',
      listPullRequestReviews: 'read',
      listBranches: 'read',
      getFileContents: 'read',
      listCommits: 'read',
      getCommit: 'read',
      listReleases: 'read',
      listWorkflowRuns: 'read',
      getWorkflowRun: 'read',
      createIssue: 'write',
      createIssueComment: 'write',
      addIssueLabels: 'write',
      createPullRequest: 'write',
      createBranch: 'write',
      updateIssue: 'destroy',
      mergePullRequest: 'destroy',
    };

    it('exposes exactly the expected actions as tools with the expected scope', () => {
      const actual = Object.fromEntries(
        Object.entries(Gitea.actions).map(([name, action]) => [name, action.scope])
      );
      expect(actual).toEqual(expectedScopes);
      for (const action of Object.values(Gitea.actions)) {
        expect(action.isTool).toBe(true);
        expect(typeof action.description).toBe('string');
        expect(action.description?.length).toBeGreaterThan(40);
      }
    });

    it('keeps the test button enabled', () => {
      expect(Gitea.test.enabled).toBe(true);
    });
  });

  describe('test handler', () => {
    it('checks the credential by fetching the current user', async () => {
      mockGet.mockResolvedValueOnce({ data: { login: 'jsmith' } });
      await expect(Gitea.test.handler(mockContext)).resolves.toEqual({});
      expect(mockGet).toHaveBeenCalledWith(`${BASE}/user`);
    });

    it('fails when the credential is rejected', async () => {
      mockGet.mockRejectedValueOnce(new Error('Request failed with status code 401'));
      await expect(Gitea.test.handler(mockContext)).rejects.toThrow('401');
    });
  });

  describe('read actions', () => {
    it('getCurrentUser returns the profile', async () => {
      mockGet.mockResolvedValueOnce({ data: { login: 'jsmith', id: 7 } });
      await expect(run('getCurrentUser', {})).resolves.toEqual({ login: 'jsmith', id: 7 });
      expect(mockGet).toHaveBeenCalledWith(`${BASE}/user`);
    });

    it('searchRepositories unwraps the { ok, data } envelope and pages it', async () => {
      const repos = [{ name: 'kibana', owner: { login: 'elastic' } }];
      mockGet.mockResolvedValueOnce(
        listResponse({ ok: true, data: repos }, { 'x-total-count': '120' })
      );
      const result = await run('searchRepositories', {
        query: 'kib',
        includeDescription: true,
        archived: false,
        sort: 'stars',
        order: 'desc',
        limit: 10,
      });
      expect(mockGet).toHaveBeenCalledWith(`${BASE}/repos/search`, {
        params: {
          q: 'kib',
          includeDesc: true,
          archived: false,
          sort: 'stars',
          order: 'desc',
          page: 1,
          limit: 10,
        },
      });
      expect(result).toEqual({ values: repos, page: 1, limit: 10, total: 120, hasMore: true });
    });

    it('searchRepositories returns an empty page when the envelope has no data', async () => {
      mockGet.mockResolvedValueOnce(listResponse({ ok: true }));
      await expect(run('searchRepositories', { query: 'x' })).resolves.toMatchObject({
        values: [],
        hasMore: false,
      });
    });

    it('getRepository requests the repository path', async () => {
      mockGet.mockResolvedValueOnce({ data: { full_name: 'elastic/kibana' } });
      await expect(run('getRepository', repoArgs)).resolves.toEqual({
        full_name: 'elastic/kibana',
      });
      expect(mockGet).toHaveBeenCalledWith(REPO);
    });

    it('searchUsers unwraps the { ok, data } envelope', async () => {
      mockGet.mockResolvedValueOnce(listResponse({ ok: true, data: [{ login: 'jsmith' }] }));
      const result = await run('searchUsers', { query: 'smith' });
      expect(mockGet).toHaveBeenCalledWith(`${BASE}/users/search`, {
        params: { q: 'smith', page: 1, limit: 30 },
      });
      expect(result).toMatchObject({ values: [{ login: 'jsmith' }] });
    });

    it('listIssues sends comma-joined label names and omits unset filters', async () => {
      mockGet.mockResolvedValueOnce(
        listResponse([{ number: 3, title: 'Bug' }], { 'x-total-count': '1' })
      );
      const result = await run('listIssues', {
        ...repoArgs,
        labels: ['bug', 'good first issue'],
        assignedTo: 'jsmith',
      });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/issues`, {
        params: {
          state: 'open',
          type: 'issues',
          labels: 'bug,good first issue',
          assigned_by: 'jsmith',
          page: 1,
          limit: 30,
        },
      });
      expect(result).toEqual({
        values: [{ number: 3, title: 'Bug' }],
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false,
      });
    });

    it('listIssues can list pull requests as issues', async () => {
      await run('listIssues', { ...repoArgs, type: 'pulls', state: 'all', query: 'fix' });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/issues`, {
        params: { state: 'all', type: 'pulls', q: 'fix', page: 1, limit: 30 },
      });
    });

    it('getIssue requests the issue by number', async () => {
      mockGet.mockResolvedValueOnce({ data: { number: 42, title: 'Bug' } });
      await expect(run('getIssue', { ...repoArgs, number: 42 })).resolves.toEqual({
        number: 42,
        title: 'Bug',
      });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/issues/42`);
    });

    it('listIssueComments returns every comment without paging', async () => {
      const comments = [{ id: 1, body: 'first' }];
      mockGet.mockResolvedValueOnce({ data: comments });
      await expect(
        run('listIssueComments', { ...repoArgs, number: 42, since: '2025-01-01T00:00:00Z' })
      ).resolves.toEqual(comments);
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/issues/42/comments`, {
        params: { since: '2025-01-01T00:00:00Z' },
      });
    });

    it('listLabels pages the labels of a repository', async () => {
      mockGet.mockResolvedValueOnce(listResponse([{ id: 9, name: 'bug' }]));
      await expect(run('listLabels', repoArgs)).resolves.toMatchObject({
        values: [{ id: 9, name: 'bug' }],
      });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/labels`, { params: { page: 1, limit: 30 } });
    });

    it('listPullRequests maps filters to the Gitea parameter names', async () => {
      await run('listPullRequests', {
        ...repoArgs,
        state: 'closed',
        baseBranch: 'main',
        poster: 'jsmith',
        sort: 'recentupdate',
      });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/pulls`, {
        params: {
          state: 'closed',
          base_branch: 'main',
          poster: 'jsmith',
          sort: 'recentupdate',
          page: 1,
          limit: 30,
        },
      });
    });

    it('getPullRequest, files and reviews use the pull request sub-routes', async () => {
      mockGet.mockResolvedValueOnce({ data: { number: 15, mergeable: true } });
      await expect(run('getPullRequest', { ...repoArgs, number: 15 })).resolves.toEqual({
        number: 15,
        mergeable: true,
      });
      expect(mockGet).toHaveBeenLastCalledWith(`${REPO}/pulls/15`);

      mockGet.mockResolvedValueOnce(listResponse([{ filename: 'a.ts' }], { 'x-total-count': '1' }));
      await expect(run('listPullRequestFiles', { ...repoArgs, number: 15 })).resolves.toMatchObject(
        { values: [{ filename: 'a.ts' }], total: 1 }
      );
      expect(mockGet).toHaveBeenLastCalledWith(`${REPO}/pulls/15/files`, {
        params: { page: 1, limit: 30 },
      });

      mockGet.mockResolvedValueOnce(listResponse([{ state: 'APPROVED' }]));
      await expect(
        run('listPullRequestReviews', { ...repoArgs, number: 15, page: 2 })
      ).resolves.toMatchObject({ values: [{ state: 'APPROVED' }], page: 2 });
      expect(mockGet).toHaveBeenLastCalledWith(`${REPO}/pulls/15/reviews`, {
        params: { page: 2, limit: 30 },
      });
    });

    it('listBranches passes the name filter as q', async () => {
      await run('listBranches', { ...repoArgs, query: 'release' });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/branches`, {
        params: { q: 'release', page: 1, limit: 30 },
      });
    });

    describe('getFileContents', () => {
      it('encodes each path segment and sends the ref as a query parameter', async () => {
        mockGet.mockResolvedValueOnce({ data: { type: 'file', content: 'aGk=' } });
        await expect(
          run('getFileContents', {
            ...repoArgs,
            filePath: 'docs/my file#1.md',
            ref: 'release/1.0',
          })
        ).resolves.toEqual({ type: 'file', content: 'aGk=' });
        expect(mockGet).toHaveBeenCalledWith(`${REPO}/contents/docs/my%20file%231.md`, {
          params: { ref: 'release/1.0' },
        });
      });

      it('lists the repository root when no path is given', async () => {
        await run('getFileContents', repoArgs);
        expect(mockGet).toHaveBeenCalledWith(`${REPO}/contents`, { params: {} });
      });
    });

    it('listCommits turns off per-commit files, stats and verification', async () => {
      mockGet.mockResolvedValueOnce(listResponse([{ sha: 'abc1234' }], { 'x-hasmore': 'true' }));
      const result = await run('listCommits', {
        ...repoArgs,
        sha: 'main',
        path: 'src/index.ts',
        since: '2025-01-01T00:00:00Z',
      });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/commits`, {
        params: {
          sha: 'main',
          path: 'src/index.ts',
          since: '2025-01-01T00:00:00Z',
          stat: false,
          verification: false,
          files: false,
          page: 1,
          limit: 30,
        },
      });
      expect(result).toMatchObject({ values: [{ sha: 'abc1234' }], hasMore: true });
    });

    it('getCommit requests the git commit by SHA', async () => {
      mockGet.mockResolvedValueOnce({ data: { sha: 'abc1234', files: [] } });
      await expect(run('getCommit', { ...repoArgs, sha: 'abc1234' })).resolves.toEqual({
        sha: 'abc1234',
        files: [],
      });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/git/commits/abc1234`);
    });

    it('listReleases pages the releases', async () => {
      mockGet.mockResolvedValueOnce(listResponse([{ tag_name: 'v1' }]));
      await expect(run('listReleases', repoArgs)).resolves.toMatchObject({
        values: [{ tag_name: 'v1' }],
      });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/releases`, { params: { page: 1, limit: 30 } });
    });

    it('listWorkflowRuns unwraps workflow_runs and uses total_count', async () => {
      const runs = [{ id: 77, status: 'success' }];
      mockGet.mockResolvedValueOnce(listResponse({ total_count: 55, workflow_runs: runs }));
      const result = await run('listWorkflowRuns', {
        ...repoArgs,
        status: 'success',
        branch: 'main',
        headSha: 'abc1234',
      });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/actions/runs`, {
        params: { status: 'success', branch: 'main', head_sha: 'abc1234', page: 1, limit: 30 },
      });
      expect(result).toEqual({ values: runs, page: 1, limit: 30, total: 55, hasMore: true });
    });

    it('getWorkflowRun requests the run by ID', async () => {
      mockGet.mockResolvedValueOnce({ data: { id: 77 } });
      await expect(run('getWorkflowRun', { ...repoArgs, runId: 77 })).resolves.toEqual({ id: 77 });
      expect(mockGet).toHaveBeenCalledWith(`${REPO}/actions/runs/77`);
    });

    it('does not follow a Link header, it only reports that another page exists', async () => {
      mockGet.mockResolvedValueOnce(
        listResponse([{ number: 1 }], { link: '<https://evil.example/steal?page=2>; rel="next"' })
      );
      const result = await run('listIssues', repoArgs);
      expect(result).toMatchObject({ hasMore: true });
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('write actions', () => {
    it('createIssue posts snake_case fields and omits unset ones', async () => {
      mockPost.mockResolvedValueOnce({ data: { number: 8, html_url: 'https://x/8' } });
      await expect(
        run('createIssue', {
          ...repoArgs,
          title: 'Broken',
          body: 'Details',
          labels: [1, 2],
          assignees: ['jsmith'],
          dueDate: '2025-03-01T00:00:00Z',
        })
      ).resolves.toEqual({ number: 8, html_url: 'https://x/8' });
      expect(mockPost).toHaveBeenCalledWith(`${REPO}/issues`, {
        title: 'Broken',
        body: 'Details',
        labels: [1, 2],
        assignees: ['jsmith'],
        due_date: '2025-03-01T00:00:00Z',
      });
    });

    it('createIssueComment posts the body to the comments route', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 5, body: 'hi' } });
      await expect(
        run('createIssueComment', { ...repoArgs, number: 42, body: 'hi' })
      ).resolves.toEqual({ id: 5, body: 'hi' });
      expect(mockPost).toHaveBeenCalledWith(`${REPO}/issues/42/comments`, { body: 'hi' });
    });

    it('addIssueLabels posts names and IDs to the additive labels route', async () => {
      mockPost.mockResolvedValueOnce({ data: [{ name: 'bug' }] });
      await expect(
        run('addIssueLabels', { ...repoArgs, number: 42, labels: ['bug', 3] })
      ).resolves.toEqual([{ name: 'bug' }]);
      expect(mockPost).toHaveBeenCalledWith(`${REPO}/issues/42/labels`, { labels: ['bug', 3] });
    });

    it('createPullRequest posts head, base and reviewers', async () => {
      mockPost.mockResolvedValueOnce({ data: { number: 15 } });
      await expect(
        run('createPullRequest', {
          ...repoArgs,
          title: 'Fix',
          head: 'fork-user:fix',
          base: 'main',
          reviewers: ['rev1'],
        })
      ).resolves.toEqual({ number: 15 });
      expect(mockPost).toHaveBeenCalledWith(`${REPO}/pulls`, {
        title: 'Fix',
        head: 'fork-user:fix',
        base: 'main',
        reviewers: ['rev1'],
      });
    });

    it('createBranch sends old_ref_name only when a source ref is given', async () => {
      mockPost.mockResolvedValue({ data: { name: 'feature' } });
      await run('createBranch', { ...repoArgs, newBranchName: 'feature' });
      expect(mockPost).toHaveBeenLastCalledWith(`${REPO}/branches`, { new_branch_name: 'feature' });

      await run('createBranch', { ...repoArgs, newBranchName: 'feature', fromRef: 'v1.0' });
      expect(mockPost).toHaveBeenLastCalledWith(`${REPO}/branches`, {
        new_branch_name: 'feature',
        old_ref_name: 'v1.0',
      });
    });
  });

  describe('destroy actions', () => {
    it('updateIssue PATCHes only the provided fields', async () => {
      mockPatch.mockResolvedValueOnce({ data: { number: 42, state: 'closed' } });
      await expect(
        run('updateIssue', { ...repoArgs, number: 42, state: 'closed', assignees: [] })
      ).resolves.toEqual({ number: 42, state: 'closed' });
      expect(mockPatch).toHaveBeenCalledWith(`${REPO}/issues/42`, {
        state: 'closed',
        assignees: [],
      });
    });

    it('updateIssue sends milestone 0 to remove it and unset_due_date to clear the date', async () => {
      await run('updateIssue', { ...repoArgs, number: 42, milestone: 0, removeDueDate: true });
      expect(mockPatch).toHaveBeenCalledWith(`${REPO}/issues/42`, {
        milestone: 0,
        unset_due_date: true,
      });
    });

    it('mergePullRequest posts the Gitea merge option names', async () => {
      mockPost.mockResolvedValueOnce({ status: 200, data: '' });
      const result = await run('mergePullRequest', {
        ...repoArgs,
        number: 15,
        method: 'squash',
        headCommitId: 'abc1234',
        mergeTitle: 'Fix (#15)',
        mergeMessage: 'Details',
        deleteBranchAfterMerge: true,
        mergeWhenChecksSucceed: false,
      });
      expect(mockPost).toHaveBeenCalledWith(`${REPO}/pulls/15/merge`, {
        do: 'squash',
        head_commit_id: 'abc1234',
        merge_title_field: 'Fix (#15)',
        merge_message_field: 'Details',
        delete_branch_after_merge: true,
        merge_when_checks_succeed: false,
      });
      expect(result).toEqual({
        merged: true,
        scheduled: false,
        owner: 'elastic',
        repo: 'kibana',
        number: 15,
      });
    });

    it('mergePullRequest reports a merge queued for later as scheduled, not merged', async () => {
      mockPost.mockResolvedValueOnce({ status: 201, data: '' });
      const result = await run('mergePullRequest', {
        ...repoArgs,
        number: 15,
        mergeWhenChecksSucceed: true,
      });
      expect(mockPost).toHaveBeenCalledWith(`${REPO}/pulls/15/merge`, {
        do: 'merge',
        merge_when_checks_succeed: true,
      });
      expect(result).toMatchObject({ merged: false, scheduled: true });
    });

    it('mergePullRequest defaults to a merge commit', async () => {
      await run('mergePullRequest', { ...repoArgs, number: 15 });
      expect(mockPost).toHaveBeenCalledWith(`${REPO}/pulls/15/merge`, { do: 'merge' });
    });

    it('mergePullRequest surfaces a refusal instead of reporting a merge', async () => {
      mockPost.mockRejectedValueOnce(new Error('Request failed with status code 405'));
      await expect(run('mergePullRequest', { ...repoArgs, number: 15 })).rejects.toThrow('405');
    });
  });

  describe('works with an instance served from a sub-path and with /api/v1 already in the URL', () => {
    it.each([
      ['https://example.com/gitea', 'https://example.com/gitea/api/v1'],
      ['https://example.com/gitea/api/v1/', 'https://example.com/gitea/api/v1'],
    ])('%s', async (baseUrl, apiBase) => {
      const ctx = { ...mockContext, config: { baseUrl } } as unknown as ActionContext;
      await Gitea.actions.getRepository.handler(ctx, parse('getRepository', repoArgs));
      expect(mockGet).toHaveBeenCalledWith(`${apiBase}/repos/elastic/kibana`);
    });
  });

  describe('input validation', () => {
    it.each([
      ['elastic', true],
      ['kibana-docs', true],
      ['my_repo.v2', true],
      ['.github', true],
      ['a', true],
      ['..', false],
      ['.', false],
      ['', false],
      ['a/b', false],
      ['a b', false],
      ['a?b', false],
      ['a#b', false],
      ['a%2Fb', false],
      ['a:b', false],
      ['é', false],
      ['x'.repeat(101), false],
    ])('owner and repo %j accepted=%s', (value, accepted) => {
      expect(
        Gitea.actions.getRepository.input.safeParse({ owner: value, repo: 'kibana' }).success
      ).toBe(accepted);
      expect(
        Gitea.actions.getRepository.input.safeParse({ owner: 'elastic', repo: value }).success
      ).toBe(accepted);
    });

    it.each([
      ['src/index.ts', true],
      ['README.md', true],
      ['dir/sub dir/file name.txt', true],
      ['.github/workflows/ci.yml', true],
      ['a/.hidden', true],
      ['../etc/passwd', false],
      ['a/../b', false],
      ['a/..', false],
      ['./a', false],
      ['a/./b', false],
      ['/abs', false],
      ['a//b', false],
      ['a/', false],
      ['', false],
      [`${'a/'.repeat(2049)}a`, false],
    ])('filePath %j accepted=%s', (filePath, accepted) => {
      expect(Gitea.actions.getFileContents.input.safeParse({ ...repoArgs, filePath }).success).toBe(
        accepted
      );
    });

    it.each([
      ['abc1234', true],
      ['0123456789abcdef0123456789abcdef01234567', true],
      ['ABCDEF12', true],
      ['a'.repeat(64), true],
      ['abc', false],
      ['main', false],
      ['abc/../x', false],
      ['abc1234?x=1', false],
      ['abc 1234', false],
      ['a'.repeat(65), false],
    ])('commit sha %j accepted=%s', (sha, accepted) => {
      expect(Gitea.actions.getCommit.input.safeParse({ ...repoArgs, sha }).success).toBe(accepted);
    });

    it('rejects a page size above the Gitea default maximum', () => {
      expect(Gitea.actions.listIssues.input.safeParse({ ...repoArgs, limit: 50 }).success).toBe(
        true
      );
      expect(Gitea.actions.listIssues.input.safeParse({ ...repoArgs, limit: 51 }).success).toBe(
        false
      );
      expect(Gitea.actions.listIssues.input.safeParse({ ...repoArgs, page: 0 }).success).toBe(
        false
      );
    });

    it('rejects issue numbers that are not positive integers', () => {
      for (const number of [0, -1, 1.5, '42']) {
        expect(Gitea.actions.getIssue.input.safeParse({ ...repoArgs, number }).success).toBe(false);
      }
    });

    it('rejects over-long free text', () => {
      expect(
        Gitea.actions.createIssue.input.safeParse({ ...repoArgs, title: 'x'.repeat(256) }).success
      ).toBe(false);
      expect(
        Gitea.actions.createIssue.input.safeParse({
          ...repoArgs,
          title: 'ok',
          body: 'x'.repeat(65536),
        }).success
      ).toBe(false);
      expect(
        Gitea.actions.createIssue.input.safeParse({
          ...repoArgs,
          title: 'ok',
          labels: Array.from({ length: 101 }, (_, i) => i + 1),
        }).success
      ).toBe(false);
    });

    it.each([
      ['2025-01-15T00:00:00Z', true],
      ['2025-01-15T10:30:00+02:00', true],
      ['2025-01-15T10:30:00.123Z', true],
      ['2025-01-15', false],
      ['yesterday', false],
      ['2025-13-45T00:00:00Z', false],
      ['2025-01-15T00:00:00', false],
      [`2025-01-15T00:00:00Z${' '.repeat(64)}`, false],
    ])('timestamp %j accepted=%s', (since, accepted) => {
      expect(Gitea.actions.listIssues.input.safeParse({ ...repoArgs, since }).success).toBe(
        accepted
      );
    });

    it('requires at least one field to update an issue', () => {
      const schema = Gitea.actions.updateIssue.input;
      expect(schema.safeParse({ ...repoArgs, number: 1 }).success).toBe(false);
      expect(schema.safeParse({ ...repoArgs, number: 1, removeDueDate: false }).success).toBe(
        false
      );
      expect(schema.safeParse({ ...repoArgs, number: 1, assignees: [] }).success).toBe(true);
      expect(schema.safeParse({ ...repoArgs, number: 1, milestone: 0 }).success).toBe(true);
      expect(schema.safeParse({ ...repoArgs, number: 1, state: 'merged' }).success).toBe(false);
    });

    it('rejects combining dueDate and removeDueDate', () => {
      expect(
        Gitea.actions.updateIssue.input.safeParse({
          ...repoArgs,
          number: 1,
          dueDate: '2025-03-01T00:00:00Z',
          removeDueDate: true,
        }).success
      ).toBe(false);
    });

    it('does not offer merge methods that bypass the merge itself', () => {
      const schema = Gitea.actions.mergePullRequest.input;
      expect(schema.safeParse({ ...repoArgs, number: 1, method: 'manually-merged' }).success).toBe(
        false
      );
      expect(schema.safeParse({ ...repoArgs, number: 1, forceMerge: true }).success).toBe(true);
      expect(
        schema.parse({ ...repoArgs, number: 1, forceMerge: true } as Record<string, unknown>)
      ).not.toHaveProperty('forceMerge');
    });
  });
});
