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
function workspace(on: On, calls: string[][] = []) {
  mock.clock(on)
  on('session.root', () => ({ value: '/ws' }))
  on('fs.list', (_, e) => ({ value: TREE[e.path] ?? [] }))
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    if (e.argv[0] === 'git') return ran(0, REMOTES)
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
    expect(listed.text).toBe('3 open pull requests in the pane; 1 service could not be read.')

    // One gh call, one glab call for gitlab.com, git only on the repo found.
    expect(calls.filter(argv => argv[0] === 'git').map(argv => argv[2])).toEqual(['/ws/pipelines'])
    expect(calls.filter(argv => argv[0] === 'glab').at(-1)).toContain('gitlab.com')

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ ...PANE, surface })
      expect(await pane.find({ type: 'Text', text: /^▾ pipelines$/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /^ELSEWHERE$/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /^▾ acme\/website$/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /#14648 .*Pause tasks for debugging ✎ changes @robin/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /GitLab gitlab.com: not logged in/ })).toBeDefined()
      await pane.unmount()
    }

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.press({ key: 'fold:pipelines' })
    expect(await pane.find({ type: 'Text', text: /^▸ pipelines$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /#14648/ })).toBeUndefined()
    await pane.press({ key: 'fold:pipelines' })
    expect(await pane.find({ type: 'Text', text: /#14648/ })).toBeDefined()
    await pane.press({ key: 'refresh' })
    expect(toasts).toEqual(['Found 3 open pull requests'])
    await pane.unmount()
  })
})
