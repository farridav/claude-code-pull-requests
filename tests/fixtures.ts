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
