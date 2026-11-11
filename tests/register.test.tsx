import { describe, expect, mock, test } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

import { GITHUB_DATA } from './fixtures'

const dir = (name: string): FsEntry => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
const ran = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

const TREE: Record<string, FsEntry[]> = {
  '/ws': [dir('pipelines'), dir('notes'), dir('node_modules')],
  '/ws/pipelines': [dir('.git')],
  '/ws/node_modules': [dir('.git')],
}

const REMOTES = [
  'sam\tgit@github.com:sam/pipelines.git (fetch)',
  'origin\tgit@github.com:upstream/pipelines.git (fetch)',
].join('\n')

/** Stands in for the engine: one repo under /ws, gh answering with the fixture, glab not logged in. */
function workspace(on: On, calls: string[][] = [], stdins: string[] = []) {
  mock.clock(on)
  on('settings.read', (_, e) => ({ value: e.source === 'user' ? { env: { PATH: '/fakes:/usr/bin', NO_COLOR: '0' } } : { env: { PATH: '/repo/bin' } } }))
  on('session.root', () => ({ value: '/ws' }))
  on('fs.list', (_, e) => ({ value: TREE[e.path] ?? [] }))
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    if (e.init?.stdin !== undefined) stdins.push(e.init.stdin)
    if (e.argv[1] === 'auth') return ran(0, '')
    if (e.argv[0] === 'git') return ran(0, REMOTES)
    if (e.argv[0] === 'gh' && e.init?.env?.PATH !== '/fakes:/usr/bin') return ran(1, '', 'settings env not passed on')
    if (e.argv[0] === 'gh') return ran(0, JSON.stringify({ data: GITHUB_DATA }))
    return ran(1, '', 'glab: 401 Unauthorized')
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

const PANE = {
  plugin: 'pull-requests',
  component: 'Pane',
  requestId: 'pull-requests',
  props: { title: 'Pull requests', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

describe('register', () => {
  test('the pane groups PRs by session repo, says what failed, and refreshes on r', async ($, on) => {
    const calls: string[][] = []
    workspace(on, calls)
    const toasts: string[] = []
    on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
    await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })
    const listed = await $.command.run({
      command: 'prs',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    expect(listed.text).toBe('3 open pull requests in the pane; 1 service needs a login.')

    // One gh call, one glab call for gitlab.com, git only on the repo found.
    expect(calls.filter(argv => argv[0] === 'git').map(argv => argv[2])).toEqual(['/ws/pipelines'])
    expect(calls.filter(argv => argv[0] === 'glab').at(-1)).toContain('gitlab.com')

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ ...PANE, surface })
      expect(await pane.find({ type: 'Button', text: /^▾ pipelines$/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /^ELSEWHERE$/ })).toBeDefined()
      expect(await pane.find({ type: 'Button', text: /^▾ acme\/website$/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /#14648 .*Pause tasks for debugging/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /✎ changes @robin/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /^GitLab gitlab.com$/ })).toBeDefined()
      await pane.unmount()
    }

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.press({ key: 'fold:pipelines' })
    expect(await pane.find({ type: 'Button', text: /^▸ pipelines$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /#14648/ })).toBeUndefined()
    await pane.press({ key: 'fold:pipelines' })
    expect(await pane.find({ type: 'Text', text: /#14648/ })).toBeDefined()
    await pane.press({ key: 'refresh' })
    expect(toasts).toEqual(['Found 3 open pull requests'])
    await pane.unmount()
  })

  test('Review asks Claude to review that pull request by its URL alone', async ($, on) => {
    workspace(on)
    const prompts: string[] = []
    on('prompt.submit', (_, e) => (prompts.push(e.text), { text: e.text }))
    await $.session.start({ cwd: '/ws', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'prs', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.press({ key: 'review:https://github.com/upstream/pipelines/pull/14648' })
    expect(prompts).toEqual(['Review this pull request: https://github.com/upstream/pipelines/pull/14648'])
    await pane.unmount()
  })

  test('Log in takes a pasted token to glab on stdin, then refreshes', async ($, on) => {
    const calls: string[][] = []
    const stdins: string[] = []
    workspace(on, calls, stdins)
    await $.session.start({ cwd: '/ws', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'prs', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.press({ key: 'login:gitlab.com' })
    await pane.input({ key: 'token:gitlab.com', text: ' glpat-secret\n' })
    expect(calls).toContainEqual(['glab', 'auth', 'login', '--hostname', 'gitlab.com', '--stdin'])
    expect(stdins).toEqual(['glpat-secret'])
    // Refreshed after: the token went nowhere but stdin.
    expect(calls.filter(argv => argv[0] === 'glab' && argv[1] === 'api')).toHaveLength(2)
    expect(calls.flat().join(' ')).not.toContain('glpat-secret')
    await pane.unmount()
  })
})
