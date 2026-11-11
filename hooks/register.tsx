import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Login } from '../types'
import type { Io } from './prs'
import type { Group } from './prs'
import { checksMark, fetchPulls, groupPulls, isAzureProject, isHostName, logIn, plural, readLocalRepos, reference, shortName, stateMarks, tally, tokenPage } from './prs'

const PANE = 'pull-requests'
const TITLE = 'Pull requests'

// Bump a shape tag when its type changes: it declines what an older version stored.
const pullsAtom = atom({ plugin: 'pull-requests', key: 'pulls' } as const, [], { shape: 'pulls-1' })
const reposAtom = atom({ plugin: 'pull-requests', key: 'repos' } as const, [], { shape: 'repos-1' })
const errorsAtom = atom({ plugin: 'pull-requests', key: 'errors' } as const, [])
const foldedAtom = atom({ plugin: 'pull-requests', key: 'folded' } as const, [])
const loginsAtom = atom({ plugin: 'pull-requests', key: 'logins' } as const, [])
const loggingInAtom = atom({ plugin: 'pull-requests', key: 'loggingIn' } as const, null)
const loadingAtom = atom({ plugin: 'pull-requests', key: 'isLoading' } as const, false)
const checkedAtom = atom({ plugin: 'pull-requests', key: 'checkedAt' } as const, null)

export const register: Register = (on, options) => {
  const gitlabHosts = new Set(
    String(options.gitlabHosts ?? 'gitlab.com')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(isHostName),
  )
  const azureProjects = String(options.azureProjects ?? '')
    .split(',')
    .map(project => project.trim())
    .filter(isAzureProject)
  // Never more often than once a minute: every refresh calls the services' APIs.
  const refreshMs = Math.max(1, Number(options.refreshMinutes ?? 5)) * 60_000

  // Module variables start over on a reload; session.start runs again then.
  let refreshing: Promise<number> | null = null
  let refreshNow: (() => Promise<number>) | null = null
  let io: Io | null = null

  on('session.start', async ($, e, next) => {
    // The user settings' env (GH_TOKEN, a proxy) for gh and glab: a session the desktop app starts does not
    // pass it on to a plugin's commands. User settings alone: a repo's own could aim PATH at a fake gh, run unasked.
    const settingsEnv = ((await $.settings.read({ source: 'user' })) as { env?: Record<string, string> }).env ?? {}
    const local: Io = {
      list: path => $.fs.list(path),
      readFile: path => $.fs.read(path),
      run: (argv, init) => $.process.run(argv, { ...init, env: { ...settingsEnv, ...init?.env } }),
    }
    io = local
    // Resolves to how many PRs it found. One refresh at a time; a second ask joins the first.
    refreshNow = () =>
      (refreshing ??= (async () => {
        await update($, loadingAtom, () => true)
        try {
          const repos = await readLocalRepos(local, await $.session.root())
          const { pulls, errors, logins } = await fetchPulls(local, repos, gitlabHosts, azureProjects)
          await update($, reposAtom, () => repos)
          await update($, pullsAtom, () => pulls)
          await update($, errorsAtom, () => errors)
          await update($, loginsAtom, () => logins)
          const now = new Date(await $.clock.now()).toISOString()
          await update($, checkedAtom, () => now)
          return pulls.length
        } finally {
          await update($, loadingAtom, () => false)
        }
      })().finally(() => {
        refreshing = null
      }))

    await $.command.register({ name: 'prs', description: 'Show open pull requests from GitHub, GitLab and Azure DevOps in a pane' })
    void $.ui.open({ id: PANE, title: TITLE })
    void refreshNow().catch(() => 0)
    $.clock.every(refreshMs, () => void refreshNow?.().catch(() => 0))
    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await refreshNow?.()
    // Only a count: titles are other people's words, kept in the pane and out of Claude's context.
    const count = (await read($, pullsAtom)).length
    const failed = (await read($, errorsAtom)).length
    const loggedOut = (await read($, loginsAtom)).length
    const notes = [failed && `${plural(failed, 'service')} could not be read`, loggedOut && `${plural(loggedOut, 'service')} needs a login`]
    return { text: `${plural(count, 'open pull request')} in the pane${notes.filter(Boolean).map(note => `; ${note}`).join('')}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Link, Text } = $.ui.resolve(e)
    const pulls = await read($, pullsAtom)
    const groups = groupPulls(pulls, await read($, reposAtom))
    const errors = await read($, errorsAtom)
    const folded = new Set(await read($, foldedAtom))
    const logins = await read($, loginsAtom)
    const loggingIn = await read($, loggingInAtom)
    const isLoading = await read($, loadingAtom)
    const checkedAt = await read($, checkedAtom)
    const width = e.props.bodyColumns

    const refresh = async () => {
      if (!refreshNow) return
      try {
        $.ui.toast(`Found ${plural(await refreshNow(), 'open pull request')}`)
      } catch (error) {
        $.ui.toast(`Refresh failed: ${String(error)}`)
      }
    }
    const submitToken = async (login: Login, token: string) => {
      if (!io || !token.trim()) return
      const failure = await logIn(io, login, token)
      if (failure) return $.ui.toast(`Login failed: ${failure}`)
      await update($, loggingInAtom, () => null)
      await refresh()
    }
    const loginCard = (login: Login) => {
      const name = { github: 'GitHub', gitlab: `GitLab ${login.host}`, azure: `Azure DevOps ${login.host.split('/')[1]}` }[login.service]
      const isOpen = loggingIn === login.host
      return (
        <Box flexDirection="column" rowGap={1} marginTop={1} paddingX={1} borderStyle="round" borderColor="warning">
          <Box justifyContent="space-between" alignItems="center" columnGap="sm">
            <Text wrap="truncate">
              <Text bold>{name}</Text>
              <Text dimColor> not logged in</Text>
            </Text>
            <Button
              variant="primary"
              key={`login:${login.host}`}
              label={isOpen ? 'Cancel' : 'Log in'}
              onPress={() => void update($, loggingInAtom, () => (isOpen ? null : login.host))}
            />
          </Box>
          {isOpen && (
            <Box flexDirection="column" rowGap={1}>
              <Text>
                <Link href={tokenPage(login)}>Make a token</Link>
                <Text dimColor>
                  {login.service === 'azure' ? ' with the Code (Read) scope' : ' with its scopes filled in'}, then paste it here.
                </Text>
              </Text>
              <Input
                key={`token:${login.host}`}
                placeholder="Paste the token"
                submitLabel="log in"
                autoFocus
                onSubmit={token => void submitToken(login, token)}
              />
            </Box>
          )}
        </Box>
      )
    }
    const toggle = (name: string) => () =>
      void update($, foldedAtom, names => (names.includes(name) ? names.filter(one => one !== name) : [...names, name]))

    const marks = (all: { text: string; color: string }[]) => all.map(mark => <Text color={mark.color}>{` ${mark.text}`}</Text>)

    const row = (pull: Group['pulls'][number]) => {
      const check = checksMark(pull)
      const after = stateMarks(pull)
      const ref = reference(pull)
      const by = pull.isMine ? '' : ` @${pull.author}`
      // Text in a Link doesn't truncate, so the title is cut to the room its card leaves.
      const room = width - 7 - ref.length
      const title = pull.title.length > room ? `${pull.title.slice(0, Math.max(room - 1, 8))}…` : pull.title
      // Only the URL goes in the prompt: the title is someone else's words.
      const review = () => void $.prompt.submit({ text: `Review this pull request: ${pull.url}`, asUser: true })
      return (
        <Box flexDirection="column">
          <Text wrap="truncate">
            <Text bold color={check.color}>{`${check.text} `}</Text>
            <Text dimColor>{`${ref} `}</Text>
            <Link href={pull.url}>{title}</Link>
          </Text>
          <Box justifyContent="space-between" alignItems="center" columnGap="sm">
            <Text wrap="truncate">
              {' '}
              {marks(after)}
              <Text dimColor>{by}</Text>
            </Text>
            <Box columnGap="sm">
              <Button variant="secondary" key={`review:${pull.url}`} label="Review" onPress={review} />
            </Box>
          </Box>
        </Box>
      )
    }

    const group = (one: Group) => {
      const isFolded = folded.has(one.name)
      const marked = tally(one.pulls)
      const count = `  ${one.pulls.length}`
      // The card's border and padding take 4 columns, the fold arrow 2.
      const room = width - 6 - count.length - marked.reduce((sum, mark) => sum + mark.text.length + 1, 0)
      return (
        <Box
          flexDirection="column"
          rowGap={1}
          marginTop={1}
          paddingX={1}
          borderStyle="round"
          borderColor={one.isLocal ? 'suggestion' : undefined}
          borderDimColor={!one.isLocal}
        >
          <Box alignItems="center">
            {/* A desktop draws a Button's label, not its children: the label is what shows. */}
            <Button plain key={`fold:${one.name}`} label={`${isFolded ? '▸' : '▾'} ${shortName(one.name, room)}`} onPress={toggle(one.name)} />
            <Text dimColor>{count}</Text>
            {marks(marked)}
          </Box>
          {!isFolded && one.pulls.map(row)}
        </Box>
      )
    }

    const section = (label: string, list: Group[]) =>
      list.length > 0 && (
        <Box flexDirection="column" marginTop={2}>
          <Text dimColor bold>
            {label}
          </Text>
          {list.map(group)}
        </Box>
      )

    const time = checkedAt ? ` · ${checkedAt.slice(11, 16)} UTC` : ''
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between" alignItems="center" columnGap="sm">
          {isLoading ? (
            <Text color="warning">Checking for pull requests…</Text>
          ) : checkedAt ? (
            <Text wrap="truncate">
              <Text bold>{plural(pulls.length, 'open pull request')}</Text>
              {marks(tally(pulls))}
              <Text dimColor>{time}</Text>
            </Text>
          ) : (
            <Text dimColor>Not checked yet</Text>
          )}
          <Button variant="secondary" key="refresh" hotkey="r" label="Refresh" dimColor={isLoading} onPress={() => void refresh()} />
        </Box>
        {errors.map(error => (
          <Text color="error" wrap="truncate">
            {`⚠ ${error}`}
          </Text>
        ))}
        {logins.map(loginCard)}
        {checkedAt && groups.length === 0 && <Text dimColor>No open pull requests.</Text>}
        {section('IN THIS WORKSPACE', groups.filter(one => one.isLocal))}
        {section('ELSEWHERE', groups.filter(one => !one.isLocal))}
      </Box>
    )
  })
}
