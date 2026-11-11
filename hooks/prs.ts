import type { FsEntry, ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { LocalRepo, Login, PullRequest } from '../types'

/** The file and process access the mod needs, handed in by the hooks module. */
export type Io = {
  list: (path: string) => Promise<FsEntry[]>
  readFile: (path: string) => Promise<string>
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
}

/** Folders that hold other people's code, never the person's own repos. */
const IGNORE = new Set(['node_modules', 'vendor', 'venv', 'site-packages', 'bower_components', 'Pods', 'target', 'dist', 'build'])
const MAX_DEPTH = 4
/** Caps that keep one refresh small: a home folder's worth of repos, or a config of a thousand remotes, would otherwise break it. */
const MAX_REPOS = 100
const MAX_PATHS_PER_HOST = 40
const GIT_CONCURRENCY = 8
const MINE_LIMIT = 30
/** Per workspace repo: a busy upstream would otherwise flood the pane with strangers' PRs. */
const REPO_LIMIT = 5
/** Never prompt: a missing login fails and says so in the pane instead of hanging. */
const CLI_ENV = { GH_PROMPT_DISABLED: '1', NO_COLOR: '1', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }

// ---------------------------------------------------------------- repos and remotes

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

function relativePath(from: string, to: string): string {
  const a = from.split('/').filter(Boolean)
  const b = to.split('/').filter(Boolean)
  let shared = 0
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++
  return [...a.slice(shared).map(() => '..'), ...b.slice(shared)].join('/') || '.'
}

/**
 * The git repos at or under `root`, at most `maxDepth` folders down: the root
 * itself when it is a repo, else every repo below it. Never looks inside a
 * repo, nor into dot-folders, `_` folders or dependency folders. A linked
 * worktree (a `.git` file) counts as a repo: its remotes are its repo's.
 */
export async function findRepos(io: Io, root: string, maxDepth = MAX_DEPTH): Promise<string[]> {
  const found: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    const entries = await io.list(dir).catch(() => [])
    if (entries.some(entry => entry.name === '.git')) {
      found.push(dir)
      return
    }
    if (depth >= maxDepth) return
    const children = entries.filter(entry => entry.kind === 'dir' && !/^[._]/.test(entry.name) && !IGNORE.has(entry.name))
    await Promise.all(children.map(child => walk(joinPath(dir, child.name), depth + 1)))
  }
  await walk(root, 0)
  return found.sort().slice(0, MAX_REPOS)
}

/**
 * A remote URL as `{ host, path }`: scp-style `git@host:group/repo.git`,
 * `ssh://git@host:2222/group/repo.git` and `https://host/group/repo`.
 */
export function parseRemote(url: string): { host: string; path: string } | null {
  const trimmed = url.trim()
  const withScheme = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed)
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(trimmed)
  const match = withScheme ?? scp
  if (!match?.[1] || !match[2]) return null
  const path = match[2].replace(/\.git$/, '').replace(/\/+$/, '')
  // Only the characters a repo path is made of: a hostile remote can't carry escapes or query syntax.
  return /^[\w.~-]+(\/[\w.~-]+)+$/.test(path) ? { host: match[1].toLowerCase(), path } : null
}

/** Each repo's remotes as `host/path`, from `git remote -v`. */
export async function readLocalRepos(io: Io, root: string): Promise<LocalRepo[]> {
  const paths = await findRepos(io, root)
  return mapLimit(paths, GIT_CONCURRENCY, async path => {
      const ran = await io
        .run(['git', '-C', path, 'remote', '-v'], { env: CLI_ENV, timeoutMs: 10_000 })
        .catch(() => ({ exitCode: 1, stdout: '' }))
      const remotes = new Set<string>()
      for (const line of ran.exitCode === 0 ? ran.stdout.split('\n') : []) {
        const remote = parseRemote(line.split(/\s+/)[1] ?? '')
        if (remote) remotes.add(`${remote.host}/${remote.path}`)
      }
      const name = path === root ? path.slice(path.lastIndexOf('/') + 1) : relativePath(root, path)
      return { name: clean(name), remotes: [...remotes] }
  })
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Which service a host is: GitHub, a GitLab host the person listed, or
 * neither. Only listed hosts are GitLab: a cloned repo's remote must never
 * pick a host that glab, and any GITLAB_TOKEN in the environment, is sent to.
 */
export function serviceOf(host: string, gitlabHosts: ReadonlySet<string>): 'github' | 'gitlab' | null {
  if (host === 'github.com') return 'github'
  return gitlabHosts.has(host) ? 'gitlab' : null
}

/** A host name as DNS spells it, so a setting can't pass glab a flag (`-x`) or anything else. */
export function isHostName(host: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d+)?$/.test(host)
}

/** Whether a link from the API is plain https on the host that was asked, and safe to draw as a Link. */
export function isLinkOn(url: string, host: string): boolean {
  return url.startsWith(`https://${host}/`) && !/[\s\u0000-\u001f\u007f-\u009f]/.test(url)
}

/** Text from the API with control characters, ANSI escapes among them, taken out. */
export function clean(text: string): string {
  // Also bidi and zero-width marks, which can reorder or hide a title's words.
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
}

function split(remote: string): { host: string; path: string } {
  const cut = remote.indexOf('/')
  return { host: remote.slice(0, cut), path: remote.slice(cut + 1) }
}

// ---------------------------------------------------------------- GitHub

const GITHUB_FIELDS = `fragment pr on PullRequest {
  number title url isDraft updatedAt mergeable reviewDecision
  author { login } repository { nameWithOwner } headRepository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`

/** One request: your authored and review-requested PRs, and each workspace repo's latest. */
export function githubQuery(repoPaths: readonly string[]): string {
  const search = (alias: string, query: string, first: number) =>
    `${alias}: search(type: ISSUE, first: ${first}, query: ${JSON.stringify(`is:pr is:open archived:false ${query} sort:updated-desc`)}) { nodes { ...pr } }`
  const aliases = [
    search('authored', 'author:@me', MINE_LIMIT),
    search('reviewing', 'review-requested:@me', MINE_LIMIT),
    ...repoPaths.map((path, index) => search(`r${index}`, `repo:${path}`, REPO_LIMIT)),
  ]
  return `${GITHUB_FIELDS}\nquery {\n  ${aliases.join('\n  ')}\n}`
}

type GithubNode = {
  number?: number
  title: string
  url: string
  isDraft: boolean
  updatedAt: string
  mergeable: string
  reviewDecision: string | null
  author: { login: string } | null
  repository: { nameWithOwner: string }
  headRepository: { nameWithOwner: string } | null
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
}

const GITHUB_CHECKS: Record<string, PullRequest['checks']> = {
  SUCCESS: 'passing',
  FAILURE: 'failing',
  ERROR: 'failing',
  PENDING: 'pending',
  EXPECTED: 'pending',
}

export function parseGithub(data: Record<string, { nodes: (GithubNode | Record<string, never>)[] } | null>): PullRequest[] {
  const pulls: PullRequest[] = []
  for (const [alias, result] of Object.entries(data)) {
    for (const node of result?.nodes ?? []) {
      // A search of type ISSUE can return issues: they come back as empty objects.
      if (!('number' in node) || node.number === undefined) continue
      const repo = node.repository.nameWithOwner
      const head = node.headRepository?.nameWithOwner ?? null
      const state = node.commits.nodes[0]?.commit.statusCheckRollup?.state
      pulls.push({
        service: 'github',
        host: 'github.com',
        repo,
        headRepo: head && head !== repo ? head : null,
        number: node.number,
        title: clean(node.title),
        url: node.url,
        author: clean(node.author?.login ?? 'ghost'),
        isDraft: node.isDraft,
        checks: state ? (GITHUB_CHECKS[state] ?? 'other') : null,
        review: node.reviewDecision === 'APPROVED' ? 'approved' : node.reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : null,
        hasConflicts: node.mergeable === 'CONFLICTING',
        isMine: alias === 'authored',
        isReviewing: alias === 'reviewing',
        updatedAt: node.updatedAt,
      })
    }
  }
  return pulls
}

// ---------------------------------------------------------------- GitLab

const GITLAB_FIELDS = `fragment mr on MergeRequest {
  iid title webUrl draft updatedAt approved conflicts
  author { username } project { fullPath } sourceProject { fullPath }
  headPipeline { status }
}`

export function gitlabQuery(projectPaths: readonly string[]): string {
  const list = `(state: opened, sort: UPDATED_DESC, first: %n) { nodes { ...mr } }`
  const projects = projectPaths.map(
    (path, index) => `p${index}: project(fullPath: ${JSON.stringify(path)}) { mergeRequests${list.replace('%n', String(REPO_LIMIT))} }`,
  )
  const mine = `currentUser {
    authored: authoredMergeRequests${list.replace('%n', String(MINE_LIMIT))}
    reviewing: reviewRequestedMergeRequests${list.replace('%n', String(MINE_LIMIT))}
  }`
  return `${GITLAB_FIELDS}\nquery {\n  ${[mine, ...projects].join('\n  ')}\n}`
}

type GitlabNode = {
  iid: string
  title: string
  webUrl: string
  draft: boolean
  updatedAt: string
  approved: boolean | null
  conflicts: boolean
  author: { username: string } | null
  project: { fullPath: string }
  sourceProject: { fullPath: string } | null
  headPipeline: { status: string } | null
}

type GitlabList = { nodes: GitlabNode[] } | null

const GITLAB_PENDING = new Set(['CREATED', 'WAITING_FOR_RESOURCE', 'PREPARING', 'PENDING', 'RUNNING', 'SCHEDULED'])

function gitlabChecks(status: string | undefined): PullRequest['checks'] {
  if (!status) return null
  if (status === 'SUCCESS') return 'passing'
  if (status === 'FAILED') return 'failing'
  return GITLAB_PENDING.has(status) ? 'pending' : 'other'
}

export function parseGitlab(
  host: string,
  data: { currentUser?: { authored?: GitlabList; reviewing?: GitlabList } | null } & Record<string, unknown>,
): PullRequest[] {
  const lists: [string, GitlabList | undefined][] = [
    ['authored', data.currentUser?.authored],
    ['reviewing', data.currentUser?.reviewing],
    ...Object.entries(data)
      .filter(([alias]) => alias !== 'currentUser')
      .map(([alias, project]) => [alias, (project as { mergeRequests?: GitlabList } | null)?.mergeRequests] as [string, GitlabList | undefined]),
  ]
  return lists.flatMap(([alias, list]) =>
    (list?.nodes ?? []).map(node => {
      const repo = node.project.fullPath
      const source = node.sourceProject?.fullPath ?? null
      return {
        service: 'gitlab' as const,
        host,
        repo,
        headRepo: source && source !== repo ? source : null,
        number: Number(node.iid),
        title: clean(node.title),
        url: node.webUrl,
        author: clean(node.author?.username ?? 'ghost'),
        isDraft: node.draft,
        checks: gitlabChecks(node.headPipeline?.status),
        // GitLab's GraphQL has no "changes requested" a free tier sees: only approved or not.
        review: node.approved ? ('approved' as const) : null,
        hasConflicts: node.conflicts,
        isMine: alias === 'authored',
        isReviewing: alias === 'reviewing',
        updatedAt: node.updatedAt,
      }
    }),
  )
}

// ---------------------------------------------------------------- fetching

/**
 * Runs a GraphQL query through gh or glab and returns its data, plus the first
 * error. Both exit non-zero on a partial error but still print the data, so
 * the data is kept whenever it parses.
 */
async function graphql(io: Io, argv: string[]): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const ran = await io
    .run(argv, { env: CLI_ENV, timeoutMs: 30_000 })
    .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  let body: { data?: Record<string, unknown> | null; errors?: { message?: string }[] } = {}
  try {
    body = JSON.parse(ran.stdout) as typeof body
  } catch {
    // Not JSON: a login or network failure, told on stderr.
  }
  const told = body.errors?.[0]?.message ?? (ran.exitCode !== 0 ? ran.stderr.trim().split('\n')[0] || 'failed' : null)
  const failure = told === null ? null : clean(told)
  return { data: body.data ?? null, error: failure }
}

export type Fetched = { pulls: PullRequest[]; errors: string[]; logins: Login[] }

/**
 * Every open PR worth showing: one gh request for GitHub, and one glab request
 * per GitLab host, from the configured hosts and those in the repos' remotes.
 */
export async function fetchPulls(io: Io, repos: readonly LocalRepo[], gitlabHosts: ReadonlySet<string>): Promise<Fetched> {
  const remotes = [...new Set(repos.flatMap(repo => repo.remotes))].map(split)
  const githubPaths = remotes.filter(one => serviceOf(one.host, gitlabHosts) === 'github').map(one => one.path)
  const gitlabByHost = new Map<string, string[]>([...gitlabHosts].map(host => [host, []]))
  for (const one of remotes) {
    if (serviceOf(one.host, gitlabHosts) === 'gitlab') gitlabByHost.set(one.host, [...(gitlabByHost.get(one.host) ?? []), one.path])
  }

  const github = graphql(io, ['gh', 'api', 'graphql', '-f', `query=${githubQuery(githubPaths.slice(0, MAX_PATHS_PER_HOST))}`]).then(({ data, error }) => ({
    pulls: data ? parseGithub(data as Parameters<typeof parseGithub>[0]).filter(pull => isLinkOn(pull.url, 'github.com')) : [],
    ...(error && /gh auth login|401|bad credentials|unauthori[sz]ed/i.test(error)
      ? { error: null, login: { service: 'github', host: 'github.com' } satisfies Login }
      : { error: error && `GitHub: ${error}`, login: null }),
  }))
  const gitlab = [...gitlabByHost].map(([host, paths]) =>
    graphql(io, ['glab', 'api', 'graphql', '--hostname', host, '-f', `query=${gitlabQuery(paths.slice(0, MAX_PATHS_PER_HOST))}`]).then(({ data, error }) => {
      // GitLab answers an anonymous query too, with no current user.
      const isAnonymous = data !== null && data.currentUser === null
      const isLoggedOut = isAnonymous || Boolean(error && /401|unauthori[sz]ed/i.test(error))
      return {
        pulls: data ? parseGitlab(host, data as Parameters<typeof parseGitlab>[1]).filter(pull => isLinkOn(pull.url, host)) : [],
        error: !isLoggedOut && error ? `GitLab ${host}: ${error}` : null,
        login: isLoggedOut ? ({ service: 'gitlab', host } satisfies Login) : null,
      }
    }),
  )
  const results = await Promise.all([github, ...gitlab])
  return {
    pulls: dedupe(results.flatMap(result => result.pulls)),
    errors: results.map(result => result.error).filter((error): error is string => Boolean(error)),
    logins: results.flatMap(result => (result.login ? [result.login] : [])),
  }
}

const TOKEN_NAME = encodeURIComponent('Claude Code pull requests')

/** The page that makes a token with the scopes gh or glab asks for, filled in. */
export function tokenPage(login: Login): string {
  return login.service === 'github'
    ? `https://github.com/settings/tokens/new?scopes=repo,read:org,gist&description=${TOKEN_NAME}`
    : `https://${login.host}/-/user_settings/personal_access_tokens?name=${TOKEN_NAME}&scopes=api,write_repository`
}

/** Logs gh or glab in with a pasted token, passed on stdin so it never sits in an argument list. Resolves to the failure, or null. */
export async function logIn(io: Io, login: Login, token: string): Promise<string | null> {
  const argv =
    login.service === 'github'
      ? ['gh', 'auth', 'login', '--hostname', login.host, '--with-token']
      : ['glab', 'auth', 'login', '--hostname', login.host, '--stdin']
  const ran = await io
    .run(argv, { env: CLI_ENV, stdin: token.trim(), timeoutMs: 30_000 })
    .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  return ran.exitCode === 0 ? null : clean(ran.stderr.trim().split('\n')[0] || 'login failed')
}

/** One entry per PR: one of yours in a workspace repo comes back from two searches. */
export function dedupe(pulls: readonly PullRequest[]): PullRequest[] {
  const byUrl = new Map<string, PullRequest>()
  for (const pull of pulls) {
    const seen = byUrl.get(pull.url)
    byUrl.set(pull.url, seen ? { ...seen, isMine: seen.isMine || pull.isMine, isReviewing: seen.isReviewing || pull.isReviewing } : pull)
  }
  return [...byUrl.values()]
}

// ---------------------------------------------------------------- drawing

/** A project in the pane: a session repo (`isLocal`), or a repo elsewhere with PRs of yours. */
export type Group = { name: string; isLocal: boolean; pulls: PullRequest[] }

/**
 * The pane's groups: each session repo with open PRs, matched on the PR's
 * repo or the fork it comes from against any of the repo's remotes, then each
 * other repo with PRs of yours. Newest first within each; the other repos by
 * their newest PR.
 */
export function groupPulls(pulls: readonly PullRequest[], repos: readonly LocalRepo[]): Group[] {
  const newest = (a: PullRequest, b: PullRequest) => b.updatedAt.localeCompare(a.updatedAt)
  const placed = new Set<string>()
  const groups: Group[] = []
  for (const repo of repos) {
    const remotes = new Set(repo.remotes)
    const here = pulls.filter(
      pull =>
        !placed.has(pull.url) &&
        (remotes.has(`${pull.host}/${pull.repo}`) || (pull.headRepo !== null && remotes.has(`${pull.host}/${pull.headRepo}`))),
    )
    here.forEach(pull => placed.add(pull.url))
    if (here.length) groups.push({ name: repo.name, isLocal: true, pulls: here.sort(newest) })
  }
  const elsewhere = new Map<string, PullRequest[]>()
  for (const pull of [...pulls].sort(newest)) {
    if (!placed.has(pull.url)) elsewhere.set(pull.repo, [...(elsewhere.get(pull.repo) ?? []), pull])
  }
  for (const [name, rest] of elsewhere) groups.push({ name, isLocal: false, pulls: rest })
  return groups
}

/** A piece of a row: its text and the theme colour it is drawn in. */
export type Mark = { text: string; color: string }

/** The checks icon that leads every row; a PR with no checks gets a blank of the same width. */
export function checksMark(pull: PullRequest): Mark {
  switch (pull.checks) {
    case 'passing':
      return { text: '✓', color: 'success' }
    case 'failing':
      return { text: '✗', color: 'error' }
    case 'pending':
      return { text: '●', color: 'warning' }
    case 'other':
      return { text: '○', color: 'inactive' }
    default:
      return { text: ' ', color: 'inactive' }
  }
}

/** The markers after the title, each its own symbol so it reads without colour. */
export function stateMarks(pull: PullRequest): Mark[] {
  const out: Mark[] = []
  if (pull.isDraft) out.push({ text: 'draft', color: 'inactive' })
  if (pull.review === 'approved') out.push({ text: '✔ approved', color: 'success' })
  if (pull.review === 'changes') out.push({ text: '✎ changes', color: 'error' })
  if (pull.hasConflicts) out.push({ text: '⚠ conflicts', color: 'warning' })
  if (pull.isReviewing) out.push({ text: '◎ review', color: 'suggestion' })
  return out
}

/** `#12` on GitHub, `!12` on GitLab. */
export function reference(pull: PullRequest): string {
  return `${pull.service === 'gitlab' ? '!' : '#'}${pull.number}`
}

/** How many PRs have each checks state, for a group's header: `✓3 ✗1`. */
export function tally(pulls: readonly PullRequest[]): Mark[] {
  const counts = new Map<string, Mark & { count: number }>()
  for (const pull of pulls) {
    const mark = checksMark(pull)
    if (mark.text === ' ') continue
    const seen = counts.get(mark.text)
    counts.set(mark.text, { ...mark, count: (seen?.count ?? 0) + 1 })
  }
  return [...counts.values()].map(({ text, color, count }) => ({ text: `${text}${count}`, color }))
}

/** A repo's name fitted to `room`: a GitLab path nested in groups shows as its project alone. */
export function shortName(name: string, room: number): string {
  const parts = name.split('/')
  const one = parts.length > 2 ? (parts.at(-1) ?? name) : name
  return one.length > room ? `${one.slice(0, Math.max(room - 1, 1))}…` : one
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
