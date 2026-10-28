/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/** Repository actions: repositories, users, branches, files, commits, releases, and Actions runs. */

import type { ConnectorSpec } from '../../connector_spec';
import { compact, encodeFilePath, getApiBase, repoPath, toPage } from './client';
import {
  CreateBranchInputSchema,
  GetCommitInputSchema,
  GetFileContentsInputSchema,
  GetRepositoryInputSchema,
  GetWorkflowRunInputSchema,
  ListBranchesInputSchema,
  ListCommitsInputSchema,
  ListReleasesInputSchema,
  ListWorkflowRunsInputSchema,
  SearchRepositoriesInputSchema,
  SearchUsersInputSchema,
} from './types';
import type {
  CreateBranchInput,
  GetCommitInput,
  GetFileContentsInput,
  GetRepositoryInput,
  GetWorkflowRunInput,
  ListBranchesInput,
  ListCommitsInput,
  ListReleasesInput,
  ListWorkflowRunsInput,
  SearchRepositoriesInput,
  SearchUsersInput,
} from './types';

export const repositoryActions: ConnectorSpec['actions'] = {
  searchRepositories: {
    isTool: true,
    scope: 'read',
    description:
      'Search repositories visible to the token by keyword. Returns repository names, owners, descriptions, default branches, and star counts, plus paging data (values, page, total, hasMore). Use owner.login and name from the results as owner and repo in other actions.',
    input: SearchRepositoriesInputSchema,
    handler: async (ctx, input: SearchRepositoriesInput) => {
      const response = await ctx.client.get(`${getApiBase(ctx)}/repos/search`, {
        params: compact({
          q: input.query,
          includeDesc: input.includeDescription,
          topic: input.topic,
          archived: input.archived,
          sort: input.sort,
          order: input.order,
          page: input.page,
          limit: input.limit,
        }),
      });
      return toPage(response.data?.data ?? [], response, input);
    },
  },

  getRepository: {
    isTool: true,
    scope: 'read',
    description:
      'Get details of one repository: description, default branch, visibility, clone URLs, topics, and open issue and pull request counts. Use searchRepositories to find the owner and repo values.',
    input: GetRepositoryInputSchema,
    handler: async (ctx, input: GetRepositoryInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}`
      );
      return response.data;
    },
  },

  searchUsers: {
    isTool: true,
    scope: 'read',
    description:
      'Search Gitea users by username, full name, or email. Returns logins and display names. Use the login as a username when assigning issues or requesting reviews.',
    input: SearchUsersInputSchema,
    handler: async (ctx, input: SearchUsersInput) => {
      const response = await ctx.client.get(`${getApiBase(ctx)}/users/search`, {
        params: { q: input.query, page: input.page, limit: input.limit },
      });
      return toPage(response.data?.data ?? [], response, input);
    },
  },

  listBranches: {
    isTool: true,
    scope: 'read',
    description:
      'List the branches of a repository. Returns branch names, the latest commit on each, and whether the branch is protected. Supports filtering by name.',
    input: ListBranchesInputSchema,
    handler: async (ctx, input: ListBranchesInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/branches`,
        { params: compact({ q: input.query, page: input.page, limit: input.limit }) }
      );
      return toPage(response.data, response, input);
    },
  },

  getFileContents: {
    isTool: true,
    scope: 'read',
    description:
      'Read a file or list a directory in a repository. For a file, returns metadata plus the content in the base64-encoded content field (encoding: "base64"); decode it to read the text. For a directory (or the repository root when filePath is omitted), returns an array of entries with name, path, type, and size. WARNING: file content is returned in full, so large or binary files produce large payloads; check size on a directory listing first.',
    input: GetFileContentsInputSchema,
    handler: async (ctx, input: GetFileContentsInput) => {
      const filePath = input.filePath === undefined ? '' : `/${encodeFilePath(input.filePath)}`;
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/contents${filePath}`,
        { params: compact({ ref: input.ref }) }
      );
      return response.data;
    },
  },

  listCommits: {
    isTool: true,
    scope: 'read',
    description:
      'List commits of a repository, newest first. Returns commit SHAs, authors, messages, and timestamps without file lists or diff statistics (use getCommit for those). Optionally start from a branch or SHA, restrict to a file path, or to a time range.',
    input: ListCommitsInputSchema,
    handler: async (ctx, input: ListCommitsInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/commits`,
        {
          params: compact({
            sha: input.sha,
            path: input.path,
            since: input.since,
            until: input.until,
            // Per-commit file lists, stats and signature checks make the page much larger.
            stat: false,
            verification: false,
            files: false,
            page: input.page,
            limit: input.limit,
          }),
        }
      );
      return toPage(response.data, response, input);
    },
  },

  getCommit: {
    isTool: true,
    scope: 'read',
    description:
      'Get one commit by SHA. Returns the author, committer, message, parent commits, the list of changed files, and addition and deletion statistics. Use the sha values returned by listCommits.',
    input: GetCommitInputSchema,
    handler: async (ctx, input: GetCommitInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/git/commits/${encodeURIComponent(
          input.sha
        )}`
      );
      return response.data;
    },
  },

  listReleases: {
    isTool: true,
    scope: 'read',
    description:
      'List the releases of a repository, newest first. Returns tag names, titles, release notes, draft and pre-release flags, and publication dates.',
    input: ListReleasesInputSchema,
    handler: async (ctx, input: ListReleasesInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/releases`,
        { params: { page: input.page, limit: input.limit } }
      );
      return toPage(response.data, response, input);
    },
  },

  listWorkflowRuns: {
    isTool: true,
    scope: 'read',
    description:
      'List Gitea Actions workflow runs of a repository, newest first. Returns run IDs, workflow names, status, conclusion, branch, commit SHA, trigger event, and timestamps. Supports filtering by status, branch, event, actor, and commit. Requires a Gitea version with the Actions REST API; older versions answer 404.',
    input: ListWorkflowRunsInputSchema,
    handler: async (ctx, input: ListWorkflowRunsInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/actions/runs`,
        {
          params: compact({
            status: input.status,
            branch: input.branch,
            event: input.event,
            actor: input.actor,
            head_sha: input.headSha,
            page: input.page,
            limit: input.limit,
          }),
        }
      );
      const { workflow_runs: runs, total_count: totalCount } = response.data ?? {};
      return toPage(runs ?? [], response, input, totalCount);
    },
  },

  getWorkflowRun: {
    isTool: true,
    scope: 'read',
    description:
      'Get one Gitea Actions workflow run by ID. Returns its status, conclusion, branch, commit SHA, trigger event, run number and attempt, and timestamps. Use the id returned by listWorkflowRuns.',
    input: GetWorkflowRunInputSchema,
    handler: async (ctx, input: GetWorkflowRunInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/actions/runs/${input.runId}`
      );
      return response.data;
    },
  },

  createBranch: {
    isTool: true,
    scope: 'write',
    description:
      'Create a new branch in a repository, starting from an existing branch, tag, or commit (the default branch when fromRef is omitted). Returns the created branch and its latest commit. Fails if the branch name already exists.',
    input: CreateBranchInputSchema,
    handler: async (ctx, input: CreateBranchInput) => {
      const response = await ctx.client.post(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/branches`,
        compact({ new_branch_name: input.newBranchName, old_ref_name: input.fromRef })
      );
      return response.data;
    },
  },
};
