import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Io } from './prs'
import type { Group } from './prs'
import { checksMark, fetchPulls, groupPulls, isHostName, plural, readLocalRepos, reference, stateMarks, tally } from './prs'

const PANE = 'pull-requests'
const TITLE = 'Pull requests'

// Bump a shape tag when its type changes: it declines what an older version stored.
const pullsAtom = atom({ plugin: 'pull-requests', key: 'pulls' } as const, [], { shape: 'pulls-1' })
const reposAtom = atom({ plugin: 'pull-requests', key: 'repos' } as const, [], { shape: 'repos-1' })
const errorsAtom = atom({ plugin: 'pull-requests', key: 'errors' } as const, [])
const foldedAtom = atom({ plugin: 'pull-requests', key: 'folded' } as const, [])
const loadingAtom = atom({ plugin: 'pull-requests', key: 'isLoading' } as const, false)
const checkedAtom = atom({ plugin: 'pull-requests', key: 'checkedAt' } as const, null)

export const register: Register = (on, options) => {
  const gitlabHosts = new Set(
    String(options.gitlabHosts ?? 'gitlab.com')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(isHostName),
  )
  // Never more often than once a minute: every refresh calls the GitHub and GitLab APIs.
  const refreshMs = Math.max(1, Number(options.refreshMinutes ?? 5)) * 60_000

  // Module variables start over on a reload; session.start runs again then.
  let refreshing: Promise<number> | null = null
  let refreshNow: (() => Promise<number>) | null = null

  on('session.start', async ($, e, next) => {
    const io: Io = {
      list: path => $.fs.list(path),
      readFile: path => $.fs.read(path),
      run: (argv, init) => $.process.run(argv, init),
    }
    // Resolves to how many PRs it found. One refresh at a time; a second ask joins the first.
    refreshNow = () =>
      (refreshing ??= (async () => {
        await update($, loadingAtom, () => true)
        try {
          const repos = await readLocalRepos(io, await $.session.root())
          const { pulls, errors } = await fetchPulls(io, repos, gitlabHosts)
          await update($, reposAtom, () => repos)
          await update($, pullsAtom, () => pulls)
          await update($, errorsAtom, () => errors)
          const now = new Date(await $.clock.now()).toISOString()
          await update($, checkedAtom, () => now)
          return pulls.length
        } finally {
          await update($, loadingAtom, () => false)
        }
      })().finally(() => {
        refreshing = null
      }))

    await $.command.register({ name: 'prs', description: 'Show open pull requests from GitHub and GitLab in a pane' })
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
    return { text: `${plural(count, 'open pull request')} in the pane${failed ? `; ${plural(failed, 'service')} could not be read` : ''}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const pulls = await read($, pullsAtom)
    const groups = groupPulls(pulls, await read($, reposAtom))
    const errors = await read($, errorsAtom)
    const folded = new Set(await read($, foldedAtom))
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
    const toggle = (name: string) => () =>
      void update($, foldedAtom, names => (names.includes(name) ? names.filter(one => one !== name) : [...names, name]))

    const marks = (all: { text: string; color: string }[]) => all.map(mark => <Text color={mark.color}>{` ${mark.text}`}</Text>)

    const row = (pull: Group['pulls'][number]) => {
      const check = checksMark(pull)
      const after = stateMarks(pull)
      const ref = reference(pull)
      const by = pull.isMine ? '' : ` @${pull.author}`
      // Text in a Link doesn't truncate, so the title is cut to the room the rest leaves.
      const room = width - 6 - ref.length - by.length - after.reduce((sum, mark) => sum + mark.text.length + 1, 0)
      const title = pull.title.length > room ? `${pull.title.slice(0, Math.max(room - 1, 8))}…` : pull.title
      return (
        <Text wrap="truncate">
          <Text bold color={check.color}>{`   ${check.text} `}</Text>
          <Text dimColor>{`${ref} `}</Text>
          <Link href={pull.url}>{title}</Link>
          {marks(after)}
          <Text dimColor>{by}</Text>
        </Text>
      )
    }

    const group = (one: Group) => {
      const isFolded = folded.has(one.name)
      return (
        <Box flexDirection="column">
          <Button plain key={`fold:${one.name}`} label={one.name} onPress={toggle(one.name)}>
            <Text bold color={one.isLocal ? 'suggestion' : undefined}>
              {isFolded ? '▸ ' : '▾ '}
              {one.name}
            </Text>
            <Text dimColor>{`  ${one.pulls.length}`}</Text>
            {marks(tally(one.pulls))}
          </Button>
          {!isFolded && one.pulls.map(row)}
        </Box>
      )
    }

    const section = (label: string, list: Group[]) =>
      list.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor bold>
            {label}
          </Text>
          {list.map(group)}
        </Box>
      )

    const time = checkedAt ? ` · ${checkedAt.slice(11, 16)} UTC` : ''
    return (
      <Box flexDirection="column">
        <Box columnGap="sm">
          <Button key="refresh" hotkey="r" label="Refresh" dimColor={isLoading} onPress={() => void refresh()} />
        </Box>
        {isLoading ? (
          <Text color="warning">Checking GitHub and GitLab…</Text>
        ) : checkedAt ? (
          <Text wrap="truncate">
            <Text bold>{plural(pulls.length, 'open pull request')}</Text>
            {marks(tally(pulls))}
            <Text dimColor>{time}</Text>
          </Text>
        ) : (
          <Text dimColor>Not checked yet</Text>
        )}
        {errors.map(error => (
          <Text color="error" wrap="truncate">
            {`⚠ ${error}`}
          </Text>
        ))}
        {checkedAt && groups.length === 0 && <Text dimColor>No open pull requests.</Text>}
        {section('IN THIS WORKSPACE', groups.filter(one => one.isLocal))}
        {section('ELSEWHERE', groups.filter(one => !one.isLocal))}
      </Box>
    )
  })
}
