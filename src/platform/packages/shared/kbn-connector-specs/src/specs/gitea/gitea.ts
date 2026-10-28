/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/**
 * Gitea Connector
 *
 * Connects to the Gitea REST API (`/api/v1`) of a self-hosted or hosted Gitea instance to
 * search repositories, read and manage issues and pull requests, browse repository files and
 * commits, and inspect Gitea Actions runs.
 *
 * Auth: access token sent as `Authorization: Bearer <token>` (Gitea also accepts the
 * `token <token>` form). Required token scopes depend on the action:
 *   read:user, read:repository, read:issue, write:repository, write:issue
 */

import { i18n } from '@kbn/i18n';
import { z, lazySchema } from '@kbn/zod/v4';
import { UISchemas } from '../../connector_spec_ui';
import type { ConnectorSpec } from '../../connector_spec';
import { getApiBase } from './client';
import { issueActions } from './issue_actions';
import { pullRequestActions } from './pull_request_actions';
import { repositoryActions } from './repository_actions';
import { GetCurrentUserInputSchema } from './types';

export const Gitea: ConnectorSpec = {
  metadata: {
    id: '.gitea',
    displayName: 'Gitea',
    description: i18n.translate('connectorSpecs.gitea.metadata.description', {
      defaultMessage:
        'Search repositories, manage issues and pull requests, browse files and commits, and inspect Actions runs in Gitea.',
    }),
    minimumLicense: 'enterprise',
    isTechnicalPreview: true,
    // New connector: ship with agentBuilder only. Add 'workflows' in a follow-up PR
    // once this connector type reaches Production-NonCanary on all nodes.
    supportedFeatureIds: ['agentBuilder'],
  },

  auth: {
    types: [
      {
        type: 'bearer',
        supportsSandbox: true,
        defaults: {},
        overrides: {
          label: i18n.translate('connectorSpecs.gitea.auth.bearer.label', {
            defaultMessage: 'Access token',
          }),
          meta: {
            token: {
              label: i18n.translate('connectorSpecs.gitea.auth.bearer.token.label', {
                defaultMessage: 'Access token',
              }),
              helpText: i18n.translate('connectorSpecs.gitea.auth.bearer.token.helpText', {
                defaultMessage:
                  'A Gitea personal access token. Reading needs the read:user, read:repository, and read:issue scopes; creating and changing issues, pull requests, and branches also needs write:issue and write:repository.',
              }),
            },
          },
        },
      },
    ],
  },

  schema: lazySchema(() =>
    z.object({
      baseUrl: UISchemas.url('https://gitea.example.com')
        .describe(
          'Gitea instance URL, for example https://gitea.example.com. The /api/v1 path is added automatically.'
        )
        .meta({
          label: i18n.translate('connectorSpecs.gitea.config.baseUrl.label', {
            defaultMessage: 'Gitea instance URL',
          }),
          placeholder: 'https://gitea.example.com',
          helpText: i18n.translate('connectorSpecs.gitea.config.baseUrl.helpText', {
            defaultMessage:
              'The address of your Gitea instance, for example https://gitea.example.com or https://gitea.com. Do not include /api/v1. A sub-path such as https://example.com/gitea is supported.',
          }),
        }),
    })
  ),

  validateUrls: {
    fields: ['baseUrl'],
  },

  actions: {
    getCurrentUser: {
      isTool: true,
      scope: 'read',
      description:
        'Get the profile of the user the access token belongs to. Returns login, full name, email, and user ID. Call this first to confirm authentication works.',
      input: GetCurrentUserInputSchema,
      handler: async (ctx) => {
        const response = await ctx.client.get(`${getApiBase(ctx)}/user`);
        return response.data;
      },
    },

    ...repositoryActions,
    ...issueActions,
    ...pullRequestActions,
  },

  test: {
    enabled: true,
    description: i18n.translate('connectorSpecs.gitea.test.description', {
      defaultMessage: 'Verifies connectivity by fetching the profile of the authenticated user.',
    }),
    handler: async (ctx) => {
      await ctx.client.get(`${getApiBase(ctx)}/user`);
      return {};
    },
  },

  skill: [
    '## Gitea Connector',
    '',
    'Use this connector to work with repositories, issues, pull requests, files, commits, and Actions runs on a Gitea instance.',
    '',
    '### Key concepts',
    '- A repository is identified by two values: `owner` (a user or organization) and `repo` (the repository name), as in `owner/repo` in the Gitea URL. Every repository action needs both.',
    '- Issues and pull requests share one numbering per repository. The `number` field (for example 42 for #42) is what actions take as `number`; do not use the global `id`.',
    '- Labels are created by their numeric `id` in `createIssue` and `createPullRequest`, but `addIssueLabels` accepts names or IDs.',
    '',
    '### Action strategy',
    '- Start with `getCurrentUser` to confirm the token works.',
    '- To find a repository: `searchRepositories`, then use `owner.login` and `name` from the result in other actions.',
    '- Issue workflow: `listIssues` -> `getIssue` -> `listIssueComments` (discussion) -> `createIssueComment` / `updateIssue` / `addIssueLabels`.',
    '- Pull request workflow: `listPullRequests` -> `getPullRequest` (check `mergeable` and note `head.sha`) -> `listPullRequestFiles` (what changed) -> `listPullRequestReviews` (approvals) -> `mergePullRequest` with `headCommitId` set to `head.sha`.',
    '- To open a pull request: `createBranch` (if the branch does not exist yet), then `createPullRequest` with `head` and `base`.',
    '- Reading code: `getFileContents` with a directory path (or no path) to browse, then with a file path to read it; decode the base64 `content`. Use `ref` to read a branch, tag, or commit other than the default.',
    '- History: `listCommits` (optionally with `path`) -> `getCommit` for the changed files of one commit.',
    '- CI: `listWorkflowRuns` (filter by `status`, `branch`, or `headSha`) -> `getWorkflowRun`. The runs API needs a recent Gitea version.',
    '',
    '### Common gotchas',
    '- List actions that report paging data return `values`, `page`, `limit`, `total`, and `hasMore`. When `hasMore` is true, call again with `page` + 1. `listIssueComments` is not paginated and returns every comment.',
    '- `listIssues` returns pull requests too only when `type` is "pulls"; by default it returns issues only.',
    '- `updateIssue` replaces the assignee list and the description; it cannot change labels (use `addIssueLabels`), and there is no action to remove a label.',
    '- `mergePullRequest` is irreversible and fails when the pull request has conflicts, pending required checks, or missing approvals. Confirm with the user before merging.',
    '- Closing and reopening both go through `updateIssue` with `state` set to "closed" or "open"; this also works for pull requests.',
    '- A 404 can mean the repository does not exist or the token cannot see it. A 403 means the token lacks the required scope (`read:user`, `read:repository`, `read:issue`, `write:repository`, or `write:issue`).',
  ].join('\n'),
};
