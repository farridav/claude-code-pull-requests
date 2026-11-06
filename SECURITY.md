# Security policy

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub instead: [open a security advisory](https://github.com/farridav/claude-code-pull-requests/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within a week. Once a fix is released, the advisory is published with credit to you, unless you'd rather stay anonymous.

## Supported versions

Fixes go into the latest release only.

## What the mod can reach

The mod runs inside Claude Code with the permissions its hooks module is given. It:

- lists folders below the folder Claude Code started in, to find git repos
- runs `git remote -v` in each repo it finds, which only reads
- runs `gh api graphql` and `glab api graphql` with read-only queries, using the logins `gh` and `glab` already hold. It never sees or stores a token itself, and never prompts for one.

Those two queries are the only network calls: at session start, on Refresh, and on the refresh timer. Nothing is added to Claude's context: `/prs` reports a count, and titles stay in the pane.

What it reads from the APIs (titles, authors, links, check states, including those of private repos you can see) is kept in the session's plugin state for drawing the pane. Links are drawn only when they are `https` on the host that was asked, and titles lose control, escape and bidi characters first.

To keep a refresh small it looks at 100 repos at most and asks about 40 repo paths per host at most.
