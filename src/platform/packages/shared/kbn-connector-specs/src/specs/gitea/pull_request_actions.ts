/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/** Pull request actions: list, read, review status, open, and merge pull requests. */

import type { ConnectorSpec } from '../../connector_spec';
import { compact, getApiBase, repoPath, toPage } from './client';
import {
  CreatePullRequestInputSchema,
  GetPullRequestInputSchema,
  ListPullRequestFilesInputSchema,
  ListPullRequestReviewsInputSchema,
  ListPullRequestsInputSchema,
  MergePullRequestInputSchema,
} from './types';
import type {
  CreatePullRequestInput,
  GetPullRequestInput,
  ListPullRequestFilesInput,
  ListPullRequestReviewsInput,
  ListPullRequestsInput,
  MergePullRequestInput,
} from './types';

export const pullRequestActions: ConnectorSpec['actions'] = {
  listPullRequests: {
    isTool: true,
    scope: 'read',
    description:
      'List pull requests in a repository. Returns pull request numbers, titles, state, head and base branches, author, and whether each is merged. Supports filtering by state, target branch, and author. Use the returned number in getPullRequest, listPullRequestFiles, and mergePullRequest.',
    input: ListPullRequestsInputSchema,
    handler: async (ctx, input: ListPullRequestsInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/pulls`,
        {
          params: compact({
            state: input.state,
            base_branch: input.baseBranch,
            poster: input.poster,
            sort: input.sort,
            page: input.page,
            limit: input.limit,
          }),
        }
      );
      return toPage(response.data, response, input);
    },
  },

  getPullRequest: {
    isTool: true,
    scope: 'read',
    description:
      'Get one pull request by number. Returns the title, body, state, head and base branches with their commit SHAs (head.sha), mergeable status, merged status, reviewers, and diff statistics. Check mergeable before calling mergePullRequest, and pass head.sha as headCommitId.',
    input: GetPullRequestInputSchema,
    handler: async (ctx, input: GetPullRequestInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/pulls/${input.number}`
      );
      return response.data;
    },
  },

  listPullRequestFiles: {
    isTool: true,
    scope: 'read',
    description:
      'List the files changed by a pull request. Returns each file name, change status (added, modified, removed, renamed), and the number of added and deleted lines. Does not return the patch text.',
    input: ListPullRequestFilesInputSchema,
    handler: async (ctx, input: ListPullRequestFilesInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/pulls/${input.number}/files`,
        { params: { page: input.page, limit: input.limit } }
      );
      return toPage(response.data, response, input);
    },
  },

  listPullRequestReviews: {
    isTool: true,
    scope: 'read',
    description:
      'List the reviews on a pull request. Returns each reviewer, review state (APPROVED, REQUEST_CHANGES, COMMENT, PENDING), review body, and the commit that was reviewed. Use it to check approvals before calling mergePullRequest.',
    input: ListPullRequestReviewsInputSchema,
    handler: async (ctx, input: ListPullRequestReviewsInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/pulls/${input.number}/reviews`,
        { params: { page: input.page, limit: input.limit } }
      );
      return toPage(response.data, response, input);
    },
  },

  createPullRequest: {
    isTool: true,
    scope: 'write',
    description:
      'Open a pull request that merges the head branch into the base branch. Both branches must already exist and the head must have commits the base does not. Returns the pull request including its number and web URL (html_url). Fails if an open pull request already exists for the same branches.',
    input: CreatePullRequestInputSchema,
    handler: async (ctx, input: CreatePullRequestInput) => {
      const response = await ctx.client.post(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/pulls`,
        compact({
          title: input.title,
          head: input.head,
          base: input.base,
          body: input.body,
          labels: input.labels,
          assignees: input.assignees,
          reviewers: input.reviewers,
        })
      );
      return response.data;
    },
  },

  mergePullRequest: {
    isTool: true,
    scope: 'destroy',
    description:
      'Merge an open pull request into its base branch using the chosen method. Irreversible. Fails if the pull request has conflicts, required checks or approvals are missing, or the repository does not allow the method. Pass headCommitId (head.sha from getPullRequest) so a branch that changed after review is not merged. Returns { merged: true } when merged, or { merged: false, scheduled: true } when mergeWhenChecksSucceed queued the merge for later.',
    input: MergePullRequestInputSchema,
    handler: async (ctx, input: MergePullRequestInput) => {
      const response = await ctx.client.post(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/pulls/${input.number}/merge`,
        compact({
          do: input.method,
          head_commit_id: input.headCommitId,
          merge_title_field: input.mergeTitle,
          merge_message_field: input.mergeMessage,
          delete_branch_after_merge: input.deleteBranchAfterMerge,
          merge_when_checks_succeed: input.mergeWhenChecksSucceed,
        })
      );
      // Gitea answers 200 once the pull request is merged and 201 when the merge was only scheduled.
      const scheduled = response.status === 201;
      return {
        merged: !scheduled,
        scheduled,
        owner: input.owner,
        repo: input.repo,
        number: input.number,
      };
    },
  },
};
