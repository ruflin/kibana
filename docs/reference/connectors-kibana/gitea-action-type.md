---
navigation_title: "Gitea"
type: reference
description: "Search Gitea repositories, manage issues and pull requests, browse files and commits, and inspect Actions runs with the Gitea REST API connector."
applies_to:
  stack: preview 9.7
  serverless: preview
---

# Gitea connector [gitea-action-type]

The Gitea connector connects to the Gitea REST API. It supports searching repositories, listing and managing issues and pull requests, reading files and commits, creating branches, merging pull requests, and checking Gitea Actions runs. It works with self-hosted Gitea instances and with gitea.com.

::::{note}
This connector is currently available in **Agent Builder** only. Workflow support is planned for a future release.
::::

## Create connectors in {{kib}} [define-gitea-ui]

You can create connectors in **{{stack-manage-app}} > {{connectors-ui}}**.

### Connector configuration [gitea-connector-configuration]

Gitea connectors have the following configuration properties:

Gitea instance URL
:   The address of your Gitea instance, for example `https://gitea.example.com` or `https://gitea.com`. Do not include `/api/v1`; the connector adds it. If your instance is served from a sub-path, include it, for example `https://example.com/gitea`.

Access token
:   A Gitea personal access token. Refer to [Get API credentials](#gitea-api-credentials) for the permissions it needs.

## Test connectors [gitea-connector-test]

You can test connectors when you create or edit the connector in {{kib}}. The test verifies connectivity by fetching the profile of the user the access token belongs to. It fails if the token is rejected.

## Connector actions [gitea-connector-actions]

The Gitea connector exposes the following actions. Repository actions take an `owner` (a user or organization) and a `repo` (the repository name), as in `owner/repo` in the Gitea URL. Actions that list items return one page at a time, with `page`, `limit`, `total`, and `hasMore` fields. Page sizes are capped by your Gitea instance, which allows 50 items by default.

### Users and repositories

`getCurrentUser`
:   Get the profile of the user the access token belongs to. Returns the login, full name, email, and user ID. Call this first to confirm authentication works.

`searchRepositories`
:   Search repositories visible to the token by keyword. Optionally match descriptions or topics, filter archived repositories, and sort. Returns repository names, owners, descriptions, default branches, and star counts.

`getRepository`
:   Get details of one repository, including its description, default branch, visibility, clone URLs, topics, and open issue and pull request counts.

`searchUsers`
:   Search users by username, full name, or email. Returns logins and display names. Use a login when assigning issues or requesting reviews.

### Issues

`listIssues`
:   List issues in a repository. Supports filtering by state, keyword, label names, creator, assignee, and update time. Set `type` to `pulls` to list pull requests as issues. Returns issue numbers, titles, state, labels, assignees, and timestamps.

`getIssue`
:   Get one issue or pull request by number. Returns the title, body, state, labels, assignees, milestone, comment count, and timestamps.

`listIssueComments`
:   List all comments on an issue or pull request. This action is not paginated. Supports `since` and `before` filters. Does not include code review comments.

`listLabels`
:   List the labels defined in a repository. Returns label IDs, names, colors, and descriptions.

`createIssue`
:   Create an issue. Optionally set the description, labels (by ID), assignees (by username), milestone, and due date. Returns the created issue including its number and web URL.

`createIssueComment`
:   Add a comment to an issue or pull request. Returns the created comment.

`addIssueLabels`
:   Add labels, by name or ID, to an issue or pull request. Existing labels are kept. Returns the labels now on the item.

`updateIssue`
:   Update an issue or pull request: title, description, state (`open` or `closed`), assignees, milestone, or due date. At least one field is required. The `assignees` field replaces the whole assignee list, and `body` replaces the description. This action cannot change labels; use `addIssueLabels`.

### Pull requests

`listPullRequests`
:   List pull requests in a repository. Supports filtering by state, target branch, and author, and several sort orders. Returns pull request numbers, titles, branches, state, and merge status.

`getPullRequest`
:   Get one pull request by number. Returns the title, body, state, head and base branches with commit SHAs, whether it is mergeable and merged, reviewers, and diff statistics.

`listPullRequestFiles`
:   List the files changed by a pull request, with each file's change status and number of added and deleted lines. Does not return patch text.

`listPullRequestReviews`
:   List the reviews on a pull request, with each reviewer, review state (`APPROVED`, `REQUEST_CHANGES`, `COMMENT`, `PENDING`), and the commit that was reviewed.

`createPullRequest`
:   Open a pull request from a head branch into a base branch. The head can be a branch in the repository or `username:branch` for a fork. Optionally set the description, labels (by ID), assignees, and reviewers. Returns the pull request including its number and web URL.

`mergePullRequest`
:   Merge an open pull request using `merge`, `rebase`, `rebase-merge`, `squash`, or `fast-forward-only`. This cannot be undone. Pass `headCommitId` (the `head.sha` from `getPullRequest`) so a branch that changed after review is not merged. Optionally set the commit title and message, delete the source branch, or merge when checks succeed. When a merge is queued for later, the result says `scheduled` instead of `merged`. The merge fails if there are conflicts, required checks or approvals are missing, or the repository does not allow the chosen method.

### Files, branches, commits, and releases

`listBranches`
:   List the branches of a repository, with the latest commit and protection status of each. Optionally filter by name.

`createBranch`
:   Create a branch from an existing branch, tag, or commit. Uses the default branch when no source is given.

`getFileContents`
:   Read a file or list a directory. For a file, returns metadata and the content in the base64-encoded `content` field. For a directory, or the repository root when `filePath` is omitted, returns the entries. File content is returned in full, so large or binary files produce large responses.

`listCommits`
:   List commits, newest first, from a branch or commit SHA. Optionally restrict to a file path or time range. The list does not include changed files or statistics; use `getCommit` for those.

`getCommit`
:   Get one commit by SHA, including its message, parents, changed files, and addition and deletion statistics.

`listReleases`
:   List the releases of a repository, with tag names, titles, release notes, and draft and pre-release flags.

### Gitea Actions

`listWorkflowRuns`
:   List Gitea Actions workflow runs, newest first. Supports filtering by status, branch, event, actor, and commit SHA. Requires a Gitea version that has the Actions REST API; older versions return a not found error.

`getWorkflowRun`
:   Get one workflow run by ID, with its status, conclusion, branch, commit SHA, trigger event, and timestamps.

## Get API credentials [gitea-api-credentials]

The Gitea connector authenticates with a personal access token.

1. In Gitea, select your avatar in the upper-right corner, then select **Settings**.
2. Select **Applications**.
3. Under **Manage Access Tokens**, enter a token name.
4. Select the permissions listed in the following table.
5. Select **Generate Token**.
6. Copy the token immediately. It is shown only once.

The permissions you need depend on the actions you use:

| Permission | Level | Needed for |
| --- | --- | --- |
| `user` | Read (`read:user`) | `getCurrentUser`, `searchUsers`, and the connector test |
| `repository` | Read (`read:repository`) | `searchRepositories`, `getRepository`, pull request, branch, file, commit, release, and workflow run read actions |
| `issue` | Read (`read:issue`) | `listIssues`, `getIssue`, `listIssueComments`, and `listLabels` |
| `issue` | Read and Write (`write:issue`) | `createIssue`, `createIssueComment`, `addIssueLabels`, and `updateIssue` |
| `repository` | Read and Write (`write:repository`) | `createPullRequest`, `createBranch`, and `mergePullRequest` |

The token acts as the user who created it, so it can only reach repositories that user can access. Merging also requires that the user has write permission on the repository.

:::{note}
For a self-hosted instance, set the **Gitea instance URL** to your own address, for example `https://gitea.example.com`. Your {{kib}} deployment must be able to reach that address over the network.
:::
