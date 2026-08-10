import { COMMENT_MARKER } from './markdown.mjs'

export class GitHubApiError extends Error {
  constructor(message, status, response) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
    this.response = response
  }
}

function headers(token) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'ldub/calldiff-action',
    'x-github-api-version': '2022-11-28',
  }
}

async function request(fetchImpl, url, { token, method = 'GET', body } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }

  if (!response.ok) {
    const message = data?.message || `GitHub API request failed with status ${response.status}`
    throw new GitHubApiError(message, response.status, data)
  }
  return data
}

function repositoryParts(repository) {
  const slash = repository.indexOf('/')
  if (slash <= 0 || slash === repository.length - 1) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: ${JSON.stringify(repository)}`)
  }
  return [repository.slice(0, slash), repository.slice(slash + 1)]
}

async function authenticatedLogin({ fetchImpl, apiUrl, token }) {
  try {
    const user = await request(fetchImpl, `${apiUrl}/user`, { token })
    return typeof user?.login === 'string' ? user.login : undefined
  } catch (error) {
    // GITHUB_TOKEN is an installation token and normally cannot call /user.
    if (error instanceof GitHubApiError && [403, 404].includes(error.status)) return undefined
    throw error
  }
}

function commentCanBeOurs(comment, login) {
  if (login) return comment.user?.login === login
  return comment.user?.login === 'github-actions[bot]' || comment.user?.type === 'Bot'
}

async function findExistingComment({ fetchImpl, apiUrl, token, owner, repo, prNumber, login }) {
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(`${apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${prNumber}/comments`)
    url.searchParams.set('per_page', '100')
    url.searchParams.set('sort', 'created')
    url.searchParams.set('direction', 'desc')
    url.searchParams.set('page', String(page))
    const comments = await request(fetchImpl, url, { token })
    if (!Array.isArray(comments)) throw new Error('GitHub returned an invalid issue-comments response')

    const found = comments.find(
      (comment) => typeof comment.body === 'string'
        && comment.body.includes(COMMENT_MARKER)
        && commentCanBeOurs(comment, login),
    )
    if (found) return found
    if (comments.length < 100) return undefined
  }
  return undefined
}

export async function upsertComment({
  fetchImpl = globalThis.fetch,
  apiUrl,
  token,
  repository,
  prNumber,
  body,
  update = true,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch')
  const [owner, repo] = repositoryParts(repository)
  let existing

  if (update) {
    const login = await authenticatedLogin({ fetchImpl, apiUrl, token })
    existing = await findExistingComment({
      fetchImpl,
      apiUrl,
      token,
      owner,
      repo,
      prNumber,
      login,
    })
  }

  if (existing) {
    try {
      const updated = await request(
        fetchImpl,
        `${apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${existing.id}`,
        { token, method: 'PATCH', body: { body } },
      )
      return { action: 'updated', comment: updated }
    } catch (error) {
      // A marker collision or token-author change should not permanently block
      // the action. GitHub still enforces who may edit the old comment.
      if (!(error instanceof GitHubApiError) || ![403, 404].includes(error.status)) throw error
    }
  }

  const created = await request(
    fetchImpl,
    `${apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${prNumber}/comments`,
    { token, method: 'POST', body: { body } },
  )
  return { action: 'created', comment: created }
}
