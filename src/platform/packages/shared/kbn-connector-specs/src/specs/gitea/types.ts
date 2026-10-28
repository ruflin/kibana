/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z, lazySchema } from '@kbn/zod/v4';

// =============================================================================
// Shared limits and patterns
// =============================================================================

/** Gitea caps a page at 50 items by default (`MAX_RESPONSE_ITEMS`); larger values are clamped. */
export const MAX_PAGE_SIZE = 50;

/** Gitea documents no limit on list inputs; this is above any realistic request. */
const MAX_LIST_ITEMS = 100;

/**
 * Owner and repository names allow letters, digits, `-`, `_` and `.`. A bare `.` or `..` is
 * rejected so a value can never act as a relative path segment.
 */
export const NAME_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/** A full or abbreviated git object ID (SHA-1 or SHA-256). */
export const COMMIT_SHA_PATTERN = /^[0-9a-fA-F]{4,64}$/;

/** Longest file path Git tooling commonly accepts. */
const MAX_FILE_PATH_LENGTH = 4096;

/**
 * A repository file path: no leading, trailing or doubled `/`, and no `.` or `..` segment, so the
 * path cannot climb out of the `/contents/` route it is appended to.
 */
export const isSafeFilePath = (value: string): boolean =>
  value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

// =============================================================================
// Shared field builders
// =============================================================================

const ownerField = () =>
  z
    .string()
    .min(1)
    .max(100)
    .regex(NAME_PATTERN, 'Must contain only letters, digits, ".", "-" and "_".')
    .describe(
      'The user or organization that owns the repository, e.g. "elastic" for gitea.example.com/elastic/kibana. Found in the owner.login field of searchRepositories results.'
    );

const repoField = () =>
  z
    .string()
    .min(1)
    .max(100)
    .regex(NAME_PATTERN, 'Must contain only letters, digits, ".", "-" and "_".')
    .describe(
      'The repository name, e.g. "kibana" for gitea.example.com/elastic/kibana. Found in the name field of searchRepositories results.'
    );

const repoFields = () => ({ owner: ownerField(), repo: repoField() });

const issueNumberField = () =>
  z
    .number()
    .int()
    .min(1)
    .describe(
      'The issue or pull request number shown in the Gitea UI (e.g. 42 for #42), returned in the number field by listIssues and listPullRequests. This is the per-repository index, not the global id field.'
    );

const pullRequestNumberField = () =>
  z
    .number()
    .int()
    .min(1)
    .describe(
      'The pull request number shown in the Gitea UI (e.g. 15 for #15), returned in the number field by listPullRequests and createPullRequest. This is the per-repository index, not the global id field.'
    );

/** An RFC 3339 timestamp, the only time format the Gitea API accepts, e.g. 2025-01-15T00:00:00Z. */
const dateTimeField = (description: string) =>
  z.iso.datetime({ offset: true }).max(64).optional().describe(description);

const pageField = () =>
  z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe('Page number for pagination (1-based, default 1).');

const limitField = () =>
  z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .default(30)
    .describe(
      `Results per page (1-${MAX_PAGE_SIZE}, default 30). The server may enforce a lower maximum.`
    );

const refField = (what: string) =>
  z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe(
      `${what} A branch name such as "main", a tag, or a commit SHA. Defaults to the repository default branch when omitted.`
    );

const labelIdsField = () =>
  z
    .array(z.number().int().min(1))
    .max(MAX_LIST_ITEMS)
    .optional()
    .describe(
      'Label IDs (numbers, not names) to apply. Use listLabels to look up the id of each label.'
    );

const usernamesField = (what: string) =>
  z
    .array(z.string().min(1).max(100))
    .max(MAX_LIST_ITEMS)
    .optional()
    .describe(`${what} Gitea usernames (logins), e.g. ["jsmith"]. Use searchUsers to find them.`);

// =============================================================================
// Read action schemas
// =============================================================================

export const GetCurrentUserInputSchema = lazySchema(() => z.object({}));
export type GetCurrentUserInput = z.infer<typeof GetCurrentUserInputSchema>;

export const SearchRepositoriesInputSchema = lazySchema(() =>
  z.object({
    query: z
      .string()
      .min(1)
      .max(500)
      .describe('Keyword to search for in repository names. Example: "kibana".'),
    includeDescription: z
      .boolean()
      .optional()
      .describe('When true, also match the keyword against repository descriptions.'),
    topic: z
      .boolean()
      .optional()
      .describe('When true, treat the keyword as a repository topic and only match topics.'),
    archived: z
      .boolean()
      .optional()
      .describe(
        'When true, return only archived repositories; when false, only non-archived ones. Omit for both.'
      ),
    sort: z
      .enum(['alpha', 'created', 'updated', 'size', 'stars', 'forks', 'id'])
      .optional()
      .describe('Attribute to sort by. Defaults to "alpha" (repository name).'),
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort order. Only applies when sort is set; defaults to "asc".'),
    page: pageField(),
    limit: limitField(),
  })
);
export type SearchRepositoriesInput = z.infer<typeof SearchRepositoriesInputSchema>;

export const GetRepositoryInputSchema = lazySchema(() => z.object({ ...repoFields() }));
export type GetRepositoryInput = z.infer<typeof GetRepositoryInputSchema>;

export const SearchUsersInputSchema = lazySchema(() =>
  z.object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe('Keyword matched against usernames, full names and email addresses.'),
    page: pageField(),
    limit: limitField(),
  })
);
export type SearchUsersInput = z.infer<typeof SearchUsersInputSchema>;

export const ListIssuesInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    state: z
      .enum(['open', 'closed', 'all'])
      .optional()
      .default('open')
      .describe('Filter by state: "open" (default), "closed" or "all".'),
    type: z
      .enum(['issues', 'pulls'])
      .optional()
      .default('issues')
      .describe(
        'Whether to list "issues" (default) or pull requests ("pulls"). Use listPullRequests for richer pull request data.'
      ),
    query: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe('Keyword to search for in titles and bodies. Example: "timeout".'),
    labels: z
      .array(z.string().min(1).max(255))
      .max(MAX_LIST_ITEMS)
      .optional()
      .describe(
        'Only return issues that have any of these label names, e.g. ["bug", "good first issue"]. Label names containing a comma cannot be matched. Unknown labels are ignored.'
      ),
    createdBy: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Only return issues created by this username.'),
    assignedTo: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Only return issues assigned to this username.'),
    since: dateTimeField(
      'Only return issues updated after this RFC 3339 timestamp, e.g. 2025-01-15T00:00:00Z.'
    ),
    before: dateTimeField(
      'Only return issues updated before this RFC 3339 timestamp, e.g. 2025-02-01T00:00:00Z.'
    ),
    page: pageField(),
    limit: limitField(),
  })
);
export type ListIssuesInput = z.infer<typeof ListIssuesInputSchema>;

export const GetIssueInputSchema = lazySchema(() =>
  z.object({ ...repoFields(), number: issueNumberField() })
);
export type GetIssueInput = z.infer<typeof GetIssueInputSchema>;

export const ListIssueCommentsInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    number: issueNumberField(),
    since: dateTimeField('Only return comments updated after this RFC 3339 timestamp.'),
    before: dateTimeField('Only return comments updated before this RFC 3339 timestamp.'),
  })
);
export type ListIssueCommentsInput = z.infer<typeof ListIssueCommentsInputSchema>;

export const ListLabelsInputSchema = lazySchema(() =>
  z.object({ ...repoFields(), page: pageField(), limit: limitField() })
);
export type ListLabelsInput = z.infer<typeof ListLabelsInputSchema>;

export const ListPullRequestsInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    state: z
      .enum(['open', 'closed', 'all'])
      .optional()
      .default('open')
      .describe('Filter by state: "open" (default), "closed" or "all".'),
    baseBranch: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe('Only return pull requests that target this branch, e.g. "main".'),
    poster: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Only return pull requests opened by this username.'),
    sort: z
      .enum([
        'oldest',
        'recentupdate',
        'recentclose',
        'leastupdate',
        'mostcomment',
        'leastcomment',
        'priority',
      ])
      .optional()
      .describe('Sort order. Defaults to newest first.'),
    page: pageField(),
    limit: limitField(),
  })
);
export type ListPullRequestsInput = z.infer<typeof ListPullRequestsInputSchema>;

export const GetPullRequestInputSchema = lazySchema(() =>
  z.object({ ...repoFields(), number: pullRequestNumberField() })
);
export type GetPullRequestInput = z.infer<typeof GetPullRequestInputSchema>;

export const ListPullRequestFilesInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    number: pullRequestNumberField(),
    page: pageField(),
    limit: limitField(),
  })
);
export type ListPullRequestFilesInput = z.infer<typeof ListPullRequestFilesInputSchema>;

export const ListPullRequestReviewsInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    number: pullRequestNumberField(),
    page: pageField(),
    limit: limitField(),
  })
);
export type ListPullRequestReviewsInput = z.infer<typeof ListPullRequestReviewsInputSchema>;

export const ListBranchesInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    query: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe('Only return branches whose name contains this text. Example: "release".'),
    page: pageField(),
    limit: limitField(),
  })
);
export type ListBranchesInput = z.infer<typeof ListBranchesInputSchema>;

export const GetFileContentsInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    filePath: z
      .string()
      .min(1)
      .max(MAX_FILE_PATH_LENGTH)
      .refine(isSafeFilePath, {
        message:
          'Must be a repository-relative path without leading, trailing or repeated "/" and without "." or ".." segments.',
      })
      .optional()
      .describe(
        'Repository-relative path of a file or directory, e.g. "src/index.ts" or "docs". Omit to list the repository root.'
      ),
    ref: refField('The branch, tag or commit to read from.'),
  })
);
export type GetFileContentsInput = z.infer<typeof GetFileContentsInputSchema>;

export const ListCommitsInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    sha: refField('The branch name or commit SHA to start listing from.'),
    path: z
      .string()
      .min(1)
      .max(MAX_FILE_PATH_LENGTH)
      .optional()
      .describe(
        'Only return commits that touched this file or directory, e.g. "src/index.ts". The limit parameter is ignored by Gitea when path is set.'
      ),
    since: dateTimeField(
      'Only return commits after this RFC 3339 timestamp, e.g. 2025-01-15T00:00:00Z.'
    ),
    until: dateTimeField(
      'Only return commits before this RFC 3339 timestamp, e.g. 2025-02-01T00:00:00Z.'
    ),
    page: pageField(),
    limit: limitField(),
  })
);
export type ListCommitsInput = z.infer<typeof ListCommitsInputSchema>;

export const GetCommitInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    sha: z
      .string()
      .min(4)
      .max(64)
      .regex(COMMIT_SHA_PATTERN, 'Must be a 4 to 64 character hexadecimal commit SHA.')
      .describe(
        'The commit SHA (full 40-character hash preferred), returned in the sha field by listCommits. Branch names are not accepted; use listCommits with sha set to a branch to resolve one.'
      ),
  })
);
export type GetCommitInput = z.infer<typeof GetCommitInputSchema>;

export const ListReleasesInputSchema = lazySchema(() =>
  z.object({ ...repoFields(), page: pageField(), limit: limitField() })
);
export type ListReleasesInput = z.infer<typeof ListReleasesInputSchema>;

export const ListWorkflowRunsInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    status: z
      .string()
      .min(1)
      .max(50)
      .optional()
      .describe(
        'Only return runs with this status: requested, pending, queued, in_progress, failure, success or skipped.'
      ),
    branch: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe('Only return runs for this branch, e.g. "main".'),
    event: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Only return runs triggered by this event, e.g. "push" or "pull_request".'),
    actor: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Only return runs triggered by this username.'),
    headSha: z
      .string()
      .min(4)
      .max(64)
      .regex(COMMIT_SHA_PATTERN, 'Must be a 4 to 64 character hexadecimal commit SHA.')
      .optional()
      .describe('Only return runs for this commit SHA.'),
    page: pageField(),
    limit: limitField(),
  })
);
export type ListWorkflowRunsInput = z.infer<typeof ListWorkflowRunsInputSchema>;

export const GetWorkflowRunInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    runId: z
      .number()
      .int()
      .min(1)
      .describe('The workflow run ID, returned in the id field by listWorkflowRuns.'),
  })
);
export type GetWorkflowRunInput = z.infer<typeof GetWorkflowRunInputSchema>;

// =============================================================================
// Write action schemas
// =============================================================================

export const CreateIssueInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    title: z.string().min(1).max(255).describe('The issue title.'),
    body: z
      .string()
      .max(65535)
      .optional()
      .describe('The issue description, in Markdown. Omit for an issue with no description.'),
    labels: labelIdsField(),
    assignees: usernamesField('Users to assign the issue to, as'),
    milestone: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('The ID of the milestone to attach the issue to. Omit for no milestone.'),
    dueDate: dateTimeField(
      'Due date as an RFC 3339 timestamp, e.g. 2025-03-01T00:00:00Z. Only the date is used.'
    ),
  })
);
export type CreateIssueInput = z.infer<typeof CreateIssueInputSchema>;

export const CreateIssueCommentInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    number: issueNumberField(),
    body: z.string().min(1).max(65535).describe('The comment text, in Markdown.'),
  })
);
export type CreateIssueCommentInput = z.infer<typeof CreateIssueCommentInputSchema>;

export const AddIssueLabelsInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    number: issueNumberField(),
    labels: z
      .array(z.union([z.string().min(1).max(255), z.number().int().min(1)]))
      .min(1)
      .max(MAX_LIST_ITEMS)
      .describe(
        'Labels to add, as label names (e.g. ["bug"]) or label IDs. Existing labels on the issue are kept. Use listLabels to see what exists.'
      ),
  })
);
export type AddIssueLabelsInput = z.infer<typeof AddIssueLabelsInputSchema>;

export const CreatePullRequestInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    title: z.string().min(1).max(255).describe('The pull request title.'),
    head: z
      .string()
      .min(1)
      .max(255)
      .describe(
        'The branch that contains the changes: a branch name in this repository (e.g. "feature/login"), or "username:branch" for a branch in that user\'s fork.'
      ),
    base: z
      .string()
      .min(1)
      .max(255)
      .describe('The branch to merge into, e.g. "main". It must already exist.'),
    body: z.string().max(65535).optional().describe('The pull request description, in Markdown.'),
    labels: labelIdsField(),
    assignees: usernamesField('Users to assign the pull request to, as'),
    reviewers: usernamesField('Users to request a review from, as'),
  })
);
export type CreatePullRequestInput = z.infer<typeof CreatePullRequestInputSchema>;

export const CreateBranchInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    newBranchName: z
      .string()
      .min(1)
      .max(255)
      .describe('Name of the branch to create, e.g. "feature/login".'),
    fromRef: refField('The branch, tag or commit to create the new branch from.'),
  })
);
export type CreateBranchInput = z.infer<typeof CreateBranchInputSchema>;

// =============================================================================
// Destroy action schemas (modify existing data)
// =============================================================================

export const UpdateIssueInputSchema = lazySchema(() =>
  z
    .object({
      ...repoFields(),
      number: issueNumberField(),
      title: z.string().min(1).max(255).optional().describe('New title.'),
      body: z
        .string()
        .max(65535)
        .optional()
        .describe('New description in Markdown. Replaces the existing description.'),
      state: z
        .enum(['open', 'closed'])
        .optional()
        .describe('Set to "closed" to close the issue or pull request, or "open" to reopen it.'),
      assignees: z
        .array(z.string().min(1).max(100))
        .max(MAX_LIST_ITEMS)
        .optional()
        .describe(
          'Usernames to assign. REPLACES all current assignees; pass an empty array to clear them.'
        ),
      milestone: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Milestone ID to attach, or 0 to remove the current milestone.'),
      dueDate: dateTimeField('New due date as an RFC 3339 timestamp. Only the date is used.'),
      removeDueDate: z
        .boolean()
        .optional()
        .describe('Set to true to clear the due date. Cannot be combined with dueDate.'),
    })
    .refine(
      (value) =>
        value.title !== undefined ||
        value.body !== undefined ||
        value.state !== undefined ||
        value.assignees !== undefined ||
        value.milestone !== undefined ||
        value.dueDate !== undefined ||
        value.removeDueDate === true,
      { message: 'Provide at least one field to update.' }
    )
    .refine((value) => !(value.dueDate !== undefined && value.removeDueDate === true), {
      message: 'dueDate and removeDueDate cannot be combined.',
    })
);
export type UpdateIssueInput = z.infer<typeof UpdateIssueInputSchema>;

export const MergePullRequestInputSchema = lazySchema(() =>
  z.object({
    ...repoFields(),
    number: pullRequestNumberField(),
    method: z
      .enum(['merge', 'rebase', 'rebase-merge', 'squash', 'fast-forward-only'])
      .optional()
      .default('merge')
      .describe(
        'How to merge: "merge" (merge commit, default), "rebase", "rebase-merge" (rebase then merge commit), "squash", or "fast-forward-only". The repository must allow the chosen method.'
      ),
    headCommitId: z
      .string()
      .min(4)
      .max(64)
      .regex(COMMIT_SHA_PATTERN, 'Must be a 4 to 64 character hexadecimal commit SHA.')
      .optional()
      .describe(
        'The commit SHA you reviewed (head.sha from getPullRequest). The merge is refused if the branch has moved since, which prevents merging unreviewed changes.'
      ),
    mergeTitle: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe('Title of the merge or squash commit. Defaults to the repository template.'),
    mergeMessage: z
      .string()
      .max(65535)
      .optional()
      .describe('Body of the merge or squash commit. Defaults to the repository template.'),
    deleteBranchAfterMerge: z
      .boolean()
      .optional()
      .describe('When true, delete the source branch after a successful merge.'),
    mergeWhenChecksSucceed: z
      .boolean()
      .optional()
      .describe(
        'When true and required checks are still running, schedule the merge for when they pass instead of failing.'
      ),
  })
);
export type MergePullRequestInput = z.infer<typeof MergePullRequestInputSchema>;
