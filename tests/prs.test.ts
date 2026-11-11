import { describe, expect, test } from 'claude-code/testing'

import type { LocalRepo } from '../types'
import { AZURE_DATA, GITHUB_DATA } from './fixtures'
import { clean, dedupe, fetchPulls, isAzureProject, isLinkOn, githubQuery, gitlabQuery, groupPulls, parseAzure, parseGithub, parseGitlab, parseRemote, reference, serviceOf, isHostName, shortName, stateMarks, tally, tokenPage } from '../hooks/prs'
import type { Io } from '../hooks/prs'

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

  test('reads every Azure DevOps form as one key, its names decoded', () => {
    const key = { host: 'dev.azure.com', path: 'acme/Ground Control/Blade-Android' }
    expect(parseRemote('git@ssh.dev.azure.com:v3/acme/Ground%20Control/Blade-Android')).toEqual(key)
    expect(parseRemote('https://acme@dev.azure.com/acme/Ground%20Control/_git/Blade-Android')).toEqual(key)
    expect(parseRemote('https://acme.visualstudio.com/DefaultCollection/Ground%20Control/_git/Blade-Android')).toEqual(key)
    expect(parseRemote('acme@vs-ssh.visualstudio.com:v3/acme/Ground%20Control/Blade-Android')).toEqual(key)
    expect(parseRemote('https://dev.azure.com/acme/p/_git/r%0a')).toBeNull()
    expect(parseRemote('https://dev.azure.com/acme/_git/r')).toBeNull()
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
    expect(isAzureProject('acme/Ground Control')).toBe(true)
    expect(isAzureProject('acme')).toBe(false)
    expect(isAzureProject('acme/-x')).toBe(false)
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

describe('Azure DevOps', () => {
  test('reads votes, drafts and conflicts, and links to the PR page', () => {
    const [mine] = parseAzure('acme', 'authored', AZURE_DATA)
    expect(mine).toMatchObject({
      service: 'azure',
      repo: 'acme/Ground Control/Blade-Android',
      url: 'https://dev.azure.com/acme/Ground%20Control/_git/Blade-Android/pullrequest/42',
      author: 'sam',
      isDraft: true,
      review: 'changes',
      hasConflicts: true,
      isMine: true,
      checks: null,
    })
    expect(reference(mine!)).toBe('!42')
    expect(parseAzure('acme', 'repo', AZURE_DATA)[1]).toMatchObject({ review: 'approved', isMine: false, author: 'robin' })
  })

  test('a PR lands in its session repo whatever the case of its names', () => {
    const remote = parseRemote('git@ssh.dev.azure.com:v3/acme/ground%20control/blade-android')!
    const repos: LocalRepo[] = [{ name: 'Blade-Android', remotes: [`${remote.host}/${remote.path}`] }]
    expect(groupPulls(parseAzure('acme', 'repo', AZURE_DATA), repos).map(group => [group.name, group.pulls.length])).toEqual([['Blade-Android', 2]])
  })

  /** An Io whose commands answer through `answer`, each call recorded. */
  const fakeIo = (calls: string[][], answer: (argv: readonly string[]) => { exitCode: number; stdout: string; stderr: string }): Io => ({
    list: async () => [],
    readFile: async () => '',
    run: async argv => (calls.push([...argv]), { ...answer(argv), isStdoutTruncated: false, isStderrTruncated: false }),
  })

  test('asks az for yours and the repo, and a missing login becomes a Log in card', async () => {
    const calls: string[][] = []
    const io = fakeIo(calls, argv =>
      argv[0] === 'az'
        ? { exitCode: 1, stdout: '', stderr: 'ERROR: Before you can run Azure DevOps commands, you need to run the login command(az login ...)' }
        : { exitCode: 0, stdout: '{"data":{}}', stderr: '' },
    )
    const fetched = await fetchPulls(io, [{ name: 'app', remotes: ['dev.azure.com/acme/Ground Control/app'] }], new Set())
    const az = calls.filter(argv => argv[1] === 'repos').map(argv => argv.find(arg => /^--(creator|reviewer|repository)=/.test(arg)))
    expect(az).toEqual(['--creator=me', '--reviewer=me', '--repository=app'])
    expect(calls.find(argv => argv[1] === 'repos')).toContain('--project=Ground Control')
    expect(fetched.logins).toEqual([{ service: 'azure', host: 'dev.azure.com/acme' }])
    expect(fetched.errors).toEqual([])
  })

  test("without a remote there, az's default project and the setting's are still asked for yours", async () => {
    const calls: string[][] = []
    const config = '[defaults]\norganization = https://dev.azure.com/acme\nproject = Ground Control\n'
    const io = fakeIo(calls, argv => ({ exitCode: 0, stdout: argv[1] === 'devops' ? config : argv[0] === 'az' ? '[]' : '{"data":{}}', stderr: '' }))
    await fetchPulls(io, [{ name: 'app', remotes: ['github.com/a/b'] }], new Set(), ['acme/Mobile'])
    const asked = calls.filter(argv => argv[1] === 'repos').map(argv => argv.filter(arg => /^--(organization|project|creator|reviewer)=/.test(arg)))
    expect(asked).toEqual([
      ['--organization=https://dev.azure.com/acme', '--project=Ground Control', '--creator=me'],
      ['--organization=https://dev.azure.com/acme', '--project=Ground Control', '--reviewer=me'],
      ['--organization=https://dev.azure.com/acme', '--project=Mobile', '--creator=me'],
      ['--organization=https://dev.azure.com/acme', '--project=Mobile', '--reviewer=me'],
    ])
  })

  test('no default and no remote there, no az repos', async () => {
    const calls: string[][] = []
    const io = fakeIo(calls, argv => ({ exitCode: 0, stdout: argv[0] === 'az' ? '[defaults]\n' : '{"data":{}}', stderr: '' }))
    await fetchPulls(io, [{ name: 'app', remotes: ['github.com/a/b'] }], new Set())
    expect(calls.some(argv => argv[1] === 'repos')).toBe(false)
  })
})

describe('names', () => {
  test('a path nested in groups shows as its project, and a long one is cut', () => {
    expect(shortName('acme/website', 20)).toBe('acme/website')
    expect(shortName('web/teams/planning/dscoe/dscoe_core/app', 22)).toBe('app')
    expect(shortName('web/teams/a-very-long-project-name', 12)).toBe('a-very-long…')
  })
})

describe('logins', () => {
  test('the token page asks for the scopes each CLI needs, on the host asked', () => {
    expect(tokenPage({ service: 'github', host: 'github.com' })).toBe(
      'https://github.com/settings/tokens/new?scopes=repo,read:org,gist&description=Claude%20Code%20pull%20requests',
    )
    expect(tokenPage({ service: 'gitlab', host: 'gitlab.example.com' })).toBe(
      'https://gitlab.example.com/-/user_settings/personal_access_tokens?name=Claude%20Code%20pull%20requests&scopes=api,write_repository',
    )
    expect(tokenPage({ service: 'azure', host: 'dev.azure.com/acme' })).toBe('https://dev.azure.com/acme/_usersSettings/tokens')
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
