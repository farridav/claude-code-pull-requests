# pull-requests

Open pull requests from GitHub and GitLab in a pane beside the chat, each with its checks, review and draft state at a glance.

## Overview

The pane opens when the session starts. It lists the open pull requests (and GitLab merge requests) for the repos you're working in, grouped by repo, then yours from anywhere else.

```
Refresh
6 open pull requests ✗2 ●1 ✓2 · 17:52 UTC

IN THIS WORKSPACE
▾ api  3 ✗1 ●1
   ✗ #148 Retry failed webhooks with backoff ✎ changes @robin
   ● #152 Reject float values in rate limits @kim
     #12 Pause tasks for debugging draft ⚠ conflicts

ELSEWHERE
▾ acme/website  1 ✓1
   ✓ #53 Add a cancellation page
▸ acme/billing  1 ✗1
▾ sam/dotfiles  1
     #3 Tidy the zsh config ◎ review
```

Each title is a link to the pull request. Click a project's name to fold it away (`▸`) or open it again (`▾`); its header counts its PRs and tallies their checks.

- **Your repos** are the git repo the session starts in, or every repo below it in a folder of repos, four levels deep at most. A pull request belongs to a repo when its target or its source matches any of the repo's remotes, so your PRs from a fork land under the repo you cloned. Each repo shows its five most recently updated.
- **Elsewhere** are the open pull requests you wrote or are asked to review, anywhere else on GitHub or the GitLab hosts you use, grouped by repo.

| Marker | Meaning |
| --- | --- |
| `✓` `✗` `●` `○` | Checks or pipeline passing, failing, running, or something else (cancelled, skipped, manual). Blank when there are none |
| `draft` | A draft |
| `✔ approved` `✎ changes` | Approved, or changes requested (GitHub only: GitLab reports approval alone) |
| `⚠ conflicts` | Conflicts with its target branch |
| `◎ review` | Your review is requested |
| `@name` | Its author, when it isn't you |

## Commands

`/prs` opens the pane, refreshes it and says how many it found. The titles stay in the pane, out of Claude's context, since most are other people's words. In the pane, **Refresh** (`r`) asks again.

## Setup

It uses the `gh` and `glab` logins you already have, and needs no token of its own.

```bash
gh auth login
```

```bash
glab auth login --hostname gitlab.com
```

Either is optional: a service you're not logged in to shows as a line in the pane saying so.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `gitlabHosts` | `gitlab.com` | GitLab hosts to ask, comma-separated: your merge requests there, and those of any session repo whose remote is on one. Only these are asked, never a host a remote names on its own. Blank it if you don't use GitLab |
| `refreshMinutes` | `5` | How often the pane asks again, once a minute at most |

GitHub Enterprise isn't covered yet: only `github.com`.

## What it runs

| Command | When |
| --- | --- |
| `git -C <repo> remote -v` | Each refresh, in each repo found |
| `gh api graphql` | Each refresh: one request covering your PRs, your review requests and each repo's latest |
| `glab api graphql --hostname <host>` | Each refresh, one request per GitLab host |

A refresh happens at session start, on Refresh or `/prs`, and on the timer. Those are the only network calls, and the queries only read.

## Developing

Run it from a checkout:

```bash
claude --plugin-dir /path/to/claude-code-pull-requests
```

| Command | What it does |
| --- | --- |
| `make deps` | Installs the Claude Code CLI version the checks run on (pinned in the Makefile) |
| `make check` | `claude plugin validate .`: the manifest, the marketplace and the hooks module |
| `make test` | `claude plugin test .`: the tests in `tests/`, run against the engine |
| `make typecheck` | `tsc -p .`, once Claude Code has written its API types into `.claude-plugin/types/` |
| `make package` | Zips the mod as `dist/pull-requests-v<version>.plugin` |

- `hooks/register.tsx` is the hooks module: the pane, `/prs` and the refresh timer.
- `hooks/prs.ts` finds the repos and their remotes, builds and parses the GraphQL queries, and groups the results.
- `types/index.d.ts` is the contract for the values kept in `$.state`.

## Releasing

1. Merge pull requests as usual, labelled so they land under the right heading (`feature`/`enhancement`, `fix`/`bugfix`/`bug`, `chore`/`dependencies`/`documentation`). Release Drafter keeps a draft of the next release up to date.
2. When you're ready, bump the version in a pull request with `make version VERSION=x.y.z` and merge it. The draft becomes `vx.y.z`, and CI attaches `pull-requests-vx.y.z.plugin` to it.
3. Publish the draft.

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes.

## Author

farridav. Released under the [MIT License](LICENSE).
