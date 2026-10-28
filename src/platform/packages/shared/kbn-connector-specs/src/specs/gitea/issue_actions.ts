/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/** Issue actions: list, read, create, comment on, label, and update issues. */

import type { ConnectorSpec } from '../../connector_spec';
import { compact, getApiBase, repoPath, toPage } from './client';
import {
  AddIssueLabelsInputSchema,
  CreateIssueCommentInputSchema,
  CreateIssueInputSchema,
  GetIssueInputSchema,
  ListIssueCommentsInputSchema,
  ListIssuesInputSchema,
  ListLabelsInputSchema,
  UpdateIssueInputSchema,
} from './types';
import type {
  AddIssueLabelsInput,
  CreateIssueCommentInput,
  CreateIssueInput,
  GetIssueInput,
  ListIssueCommentsInput,
  ListIssuesInput,
  ListLabelsInput,
  UpdateIssueInput,
} from './types';

export const issueActions: ConnectorSpec['actions'] = {
  listIssues: {
    isTool: true,
    scope: 'read',
    description:
      'List issues in a repository, newest first. Returns issue numbers, titles, state, labels, assignees, and timestamps. Supports filtering by state, keyword, labels, creator, assignee, and update time. Use the returned number in getIssue, updateIssue, createIssueComment, and addIssueLabels. Set type to "pulls" to list pull requests as issues.',
    input: ListIssuesInputSchema,
    handler: async (ctx, input: ListIssuesInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/issues`,
        {
          params: compact({
            state: input.state,
            type: input.type,
            q: input.query,
            labels: input.labels?.join(','),
            created_by: input.createdBy,
            assigned_by: input.assignedTo,
            since: input.since,
            before: input.before,
            page: input.page,
            limit: input.limit,
          }),
        }
      );
      return toPage(response.data, response, input);
    },
  },

  getIssue: {
    isTool: true,
    scope: 'read',
    description:
      'Get one issue (or pull request) by number. Returns the title, body, state, labels, assignees, milestone, comment count, and timestamps. Use listIssueComments to read the discussion.',
    input: GetIssueInputSchema,
    handler: async (ctx, input: GetIssueInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/issues/${input.number}`
      );
      return response.data;
    },
  },

  listIssueComments: {
    isTool: true,
    scope: 'read',
    description:
      'List all comments on an issue or pull request, oldest first. Returns comment IDs, authors, bodies, and timestamps. The API is not paginated, so every comment is returned; narrow with since and before for long discussions. Does not include code review comments; use listPullRequestReviews for those.',
    input: ListIssueCommentsInputSchema,
    handler: async (ctx, input: ListIssueCommentsInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/issues/${input.number}/comments`,
        { params: compact({ since: input.since, before: input.before }) }
      );
      return response.data;
    },
  },

  listLabels: {
    isTool: true,
    scope: 'read',
    description:
      'List the labels defined in a repository. Returns label IDs, names, colors, and descriptions. Use the id values when creating issues or pull requests, or the names with addIssueLabels.',
    input: ListLabelsInputSchema,
    handler: async (ctx, input: ListLabelsInput) => {
      const response = await ctx.client.get(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/labels`,
        { params: { page: input.page, limit: input.limit } }
      );
      return toPage(response.data, response, input);
    },
  },

  createIssue: {
    isTool: true,
    scope: 'write',
    description:
      'Create a new issue in a repository. Returns the created issue including its number and web URL (html_url). Labels are given as label IDs from listLabels and assignees as usernames from searchUsers.',
    input: CreateIssueInputSchema,
    handler: async (ctx, input: CreateIssueInput) => {
      const response = await ctx.client.post(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/issues`,
        compact({
          title: input.title,
          body: input.body,
          labels: input.labels,
          assignees: input.assignees,
          milestone: input.milestone,
          due_date: input.dueDate,
        })
      );
      return response.data;
    },
  },

  createIssueComment: {
    isTool: true,
    scope: 'write',
    description:
      'Add a comment to an issue or pull request. Returns the created comment including its ID, body, and author. This posts a plain discussion comment, not a code review.',
    input: CreateIssueCommentInputSchema,
    handler: async (ctx, input: CreateIssueCommentInput) => {
      const response = await ctx.client.post(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/issues/${input.number}/comments`,
        { body: input.body }
      );
      return response.data;
    },
  },

  addIssueLabels: {
    isTool: true,
    scope: 'write',
    description:
      'Add labels to an issue or pull request, keeping the labels it already has. Accepts label names or IDs. Returns the full list of labels now on the item. Use listLabels first to see which labels exist.',
    input: AddIssueLabelsInputSchema,
    handler: async (ctx, input: AddIssueLabelsInput) => {
      const response = await ctx.client.post(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/issues/${input.number}/labels`,
        { labels: input.labels }
      );
      return response.data;
    },
  },

  updateIssue: {
    isTool: true,
    scope: 'destroy',
    description:
      'Update an existing issue or pull request: title, body, state (open or closed), assignees, milestone, or due date. Only the fields you pass change, but assignees REPLACES the whole assignee list and body replaces the description. At least one field is required. Use addIssueLabels to change labels. Returns the updated issue.',
    input: UpdateIssueInputSchema,
    handler: async (ctx, input: UpdateIssueInput) => {
      const response = await ctx.client.patch(
        `${getApiBase(ctx)}${repoPath(input.owner, input.repo)}/issues/${input.number}`,
        compact({
          title: input.title,
          body: input.body,
          state: input.state,
          assignees: input.assignees,
          milestone: input.milestone,
          due_date: input.dueDate,
          unset_due_date: input.removeDueDate,
        })
      );
      return response.data;
    },
  },
};
