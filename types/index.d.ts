/** A pull request (GitHub) or merge request (GitLab), as the pane draws it. */
export type PullRequest = {
  service: 'github' | 'gitlab'
  host: string
  /** `owner/name`, or a GitLab project's full path with its groups. */
  repo: string
  /** The repo the branch comes from, when it isn't `repo` (a fork). */
  headRepo: string | null
  number: number
  title: string
  url: string
  author: string
  isDraft: boolean
  /** The latest commit's checks or pipeline; null when there are none. */
  checks: 'passing' | 'failing' | 'pending' | 'other' | null
  review: 'approved' | 'changes' | null
  hasConflicts: boolean
  isMine: boolean
  isReviewing: boolean
  /** ISO time of the last update; the pane sorts by it. */
  updatedAt: string
}

/** A service the pane could not read for want of a login: GitHub, or one GitLab host. */
export type Login = { service: 'github' | 'gitlab'; host: string }

/** A git repo in the session and the `host/path` of each of its remotes. */
export type LocalRepo = {
  /** Its path relative to the session root, or the folder's name when it is the root. */
  name: string
  remotes: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'pull-requests': {
      pulls: Shaped<PullRequest[]>
      repos: Shaped<LocalRepo[]>
      /** One line per service that could not be read (`GitLab gitlab.com: not logged in`). */
      errors: string[]
      /** The projects folded shut in the pane, by name. */
      folded: string[]
      /** The services that need a login, each drawn with a Log in button. */
      logins: Login[]
      /** The host whose token box is open, or null. */
      loggingIn: string | null
      /** True while a refresh is in flight. */
      isLoading: boolean
      /** ISO time of the last finished refresh, or null before the first. */
      checkedAt: string | null
    }
  }
}
