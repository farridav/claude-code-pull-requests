/** Trimmed from a real `gh api graphql` response to githubQuery. */
export const GITHUB_DATA = {
  authored: {
    nodes: [
      {
        number: 53,
        title: 'Add a cancellation page',
        url: 'https://github.com/acme/website/pull/53',
        isDraft: false,
        updatedAt: '2026-11-05T21:14:42Z',
        author: { login: 'sam' },
        repository: { nameWithOwner: 'acme/website' },
        headRepository: { nameWithOwner: 'acme/website' },
        reviewDecision: null,
        mergeable: 'MERGEABLE',
        commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
      },
      {
        number: 12,
        title: 'Fix parallel for loop parameters',
        url: 'https://github.com/upstream/pipelines/pull/12',
        isDraft: true,
        updatedAt: '2026-11-04T10:00:00Z',
        author: { login: 'sam' },
        repository: { nameWithOwner: 'upstream/pipelines' },
        headRepository: { nameWithOwner: 'sam/pipelines' },
        reviewDecision: 'APPROVED',
        mergeable: 'CONFLICTING',
        commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
      },
    ],
  },
  reviewing: { nodes: [{}] },
  r0: {
    nodes: [
      {
        number: 14648,
        title: 'Pause tasks for debugging',
        url: 'https://github.com/upstream/pipelines/pull/14648',
        isDraft: false,
        updatedAt: '2026-11-06T15:48:52Z',
        author: { login: 'robin' },
        repository: { nameWithOwner: 'upstream/pipelines' },
        headRepository: { nameWithOwner: 'robin/pipelines' },
        reviewDecision: 'CHANGES_REQUESTED',
        mergeable: 'MERGEABLE',
        commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
      },
    ],
  },
}

/** The fields parseAzure reads, in the shape a real `az repos pr list --output=json` prints, with made-up names. */
export const AZURE_DATA = [
  {
    pullRequestId: 42,
    title: 'Add offline maps',
    isDraft: true,
    creationDate: '2026-11-05T09:00:00.361658+00:00',
    mergeStatus: 'conflicts',
    createdBy: { displayName: 'Sam Lee', uniqueName: 'sam@acme.test' },
    reviewers: [{ vote: 10 }, { vote: -5 }],
    repository: { name: 'Blade-Android', project: { name: 'Ground Control' } },
  },
  {
    pullRequestId: 43,
    title: 'Bump the SDK',
    isDraft: false,
    creationDate: '2026-11-06T09:00:00.100040+00:00',
    mergeStatus: 'succeeded',
    createdBy: { displayName: 'Robin', uniqueName: 'robin@acme.test' },
    reviewers: [{ vote: 5 }, { vote: 0 }],
    repository: { name: 'Blade-Android', project: { name: 'Ground Control' } },
  },
]
