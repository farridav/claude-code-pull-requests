import { describe, expect, test } from 'claude-code/testing'

import type { LocalRepo } from '../types'
import { GITHUB_DATA } from './fixtures'
import { clean, dedupe, isLinkOn, githubQuery, gitlabQuery, groupPulls, parseGithub, parseGitlab, parseRemote, serviceOf, isHostName, stateMarks, tally } from '../hooks/prs'

describe('remotes', () => {
  test('reads every URL form git writes', () => {
    expect(parseRemote('git@github.com:sam/pipelines.git')).toEqual({ host: 'github.com', path: 'sam/pipelines' })
    expect(parseRemote('ssh://git@gitlab.example.com:2222/group/sub/app.git')).toEqual({
      host: 'gitlab.example.com',
      path: 'group/sub/app',
    })
    expect(parseRemote('https://user@GitHub.com/a/b/')).toEqual({ host: 'github.com', path: 'a/b' })
    expect(parseRemote('/srv/git/local.git')).toBeNull()
    expect(parseRemote('https://github.com/a/b\u001b]8;;x')).toBeNull()
    expect(parseRemote('git@github.com:a/b"){x}')).toBeNull()
    expect(parseRemote('')).toBeNull()
  })
})

describe('hosts', () => {
  test('only listed hosts are GitLab, whatever a remote calls itself', () => {
    const listed = new Set(['gitlab.example.com'])
    expect(serviceOf('github.com', listed)).toBe('github')
    expect(serviceOf('gitlab.example.com', listed)).toBe('gitlab')
    expect(serviceOf('gitlab.attacker.test', listed)).toBeNull()
  })

  test('a setting must be a plain host name', () => {
    expect(isHostName('gitlab.com')).toBe(true)
    expect(isHostName('git.example.co.uk:8443')).toBe(true)
    expect(isHostName('-x')).toBe(false)
    expect(isHostName('a b')).toBe(false)
  })

  test('titles lose control characters, escapes and bidi marks', () => {
    expect(clean('Fix \u001b[31mred\u001b[0m\nnow')).toBe('Fix [31mred[0mnow')
    expect(clean('ok\u202Edevorppa')).toBe('okdevorppa')
  })

  test('a link is drawn only when it is https on the host asked', () => {
    expect(isLinkOn('https://github.com/a/b/pull/1', 'github.com')).toBe(true)
    expect(isLinkOn('javascript:alert(1)', 'github.com')).toBe(false)
    expect(isLinkOn('https://github.com.evil.test/x', 'github.com')).toBe(false)
    expect(isLinkOn('https://github.com/a\u0007b', 'github.com')).toBe(false)
  })
})

describe('GitHub', () => {
  test('asks for yours and each repo in one query', () => {
    const query = githubQuery(['upstream/pipelines'])
    expect(query).toContain('authored: search')
    expect(query).toContain('reviewing: search')
    expect(query).toContain('r0: search(type: ISSUE, first: 5, query: "is:pr is:open archived:false repo:upstream/pipelines')
  })

  test('reads checks, review, drafts, conflicts and forks, and skips issues', () => {
    const pulls = parseGithub(GITHUB_DATA)
    expect(pulls.map(pull => pull.number)).toEqual([53, 12, 14648])
    const [failing, draft, stranger] = pulls
    expect(failing).toMatchObject({ checks: 'failing', isMine: true, headRepo: null })
    expect(draft).toMatchObject({ checks: null, review: 'approved', hasConflicts: true, isDraft: true, headRepo: 'sam/pipelines' })
    expect(stranger).toMatchObject({ checks: 'pending', review: 'changes', isMine: false })
  })
})

describe('GitLab', () => {
  test('reads merge requests from yours and from projects', () => {
    expect(gitlabQuery(['group/app'])).toContain('p0: project(fullPath: "group/app")')
    const node = {
      iid: '7',
      title: 'Add the thing',
      webUrl: 'https://gitlab.example.com/group/app/-/merge_requests/7',
      draft: false,
      updatedAt: '2026-11-01T00:00:00Z',
      approved: true,
      conflicts: false,
      author: { username: 'dee' },
      project: { fullPath: 'group/app' },
      sourceProject: { fullPath: 'group/app' },
      headPipeline: { status: 'RUNNING' },
    }
    const pulls = parseGitlab('gitlab.example.com', {
      currentUser: { authored: { nodes: [] }, reviewing: { nodes: [node] } },
      p0: { mergeRequests: { nodes: [node] } },
      p1: null,
    })
    expect(dedupe(pulls)).toEqual([
      expect.objectContaining({ number: 7, checks: 'pending', review: 'approved', isReviewing: true, headRepo: null }),
    ])
  })
})

describe('grouping', () => {
  test('groups by session repo, matching forks, then yours elsewhere', () => {
    const repos: LocalRepo[] = [{ name: 'pipelines', remotes: ['github.com/sam/pipelines', 'github.com/upstream/pipelines'] }]
    const groups = groupPulls(parseGithub(GITHUB_DATA), repos)
    expect(groups.map(group => [group.name, group.pulls.map(pull => pull.number)])).toEqual([
      ['pipelines', [14648, 12]],
      ['acme/website', [53]],
    ])
  })

  test('a header tallies checks, leaving out PRs with none', () => {
    expect(tally(parseGithub(GITHUB_DATA)).map(mark => mark.text)).toEqual(['✗1', '●1'])
  })

  test('marks read without colour', () => {
    const [, draft] = parseGithub(GITHUB_DATA)
    expect(stateMarks(draft!).map(mark => mark.text)).toEqual(['draft', '✔ approved', '⚠ conflicts'])
  })
})
