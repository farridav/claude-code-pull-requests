# Contributing

Thanks for helping make Claude Code better at keeping an eye on pull requests. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or asking for a feature

Open an issue from one of the templates. For a bug, say which service (GitHub, GitLab.com or a self-hosted GitLab) and what the pane showed. Made-up names are fine.

Report security problems privately, as [SECURITY.md](SECURITY.md) describes, not in an issue.

## Making a change

You need [Claude Code](https://code.claude.com) with mods (function hooks) enabled, `git`, and `gh` and/or `glab` logged in.

1. Fork the repo and create a branch from `main`.
2. Run the mod from your checkout in a folder that holds a repo or a few:

   ```sh
   cd ~/my-workspace
   claude --plugin-dir /path/to/claude-code-pull-requests
   ```

   Claude Code reloads the mod when you save a file, and writes its API types into `.claude-plugin/types/`.
3. Make your change. Keep it readable: plain functions in `hooks/prs.ts` for anything that queries, parses or builds text, and the hooks themselves in `hooks/register.tsx`.
4. Add or update tests in `tests/`, and run the checks:

   ```sh
   make check      # validate the manifest, marketplace and hooks module
   make test       # the tests in tests/, against the engine
   make typecheck  # tsc, once the types are written
   ```

5. Update the README if behaviour, settings or commands change.
6. Open a pull request. CI runs the same checks.

## Labels

Release notes are drafted from merged pull requests, grouped by label. Each pull request gets one of these:

| Label | Release notes heading |
| --- | --- |
| `feature`, `enhancement` | 🚀 Features |
| `fix`, `bugfix`, `bug` | 🐛 Bug Fixes |
| `chore`, `dependencies`, `documentation` | 🧰 Maintenance |

The maintainer adds them if you can't.

## Releasing (maintainers)

1. In a pull request, bump the version with `make version VERSION=x.y.z` (semver: breaking changes bump the major version).
2. Merge it. Release Drafter updates the draft release to `vx.y.z`.
3. Review the draft's notes and publish it. The release workflow checks that the tag matches `plugin.json`, runs the checks and tests, and attaches `pull-requests-vx.y.z.plugin` to the release.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By taking part you agree to it.
