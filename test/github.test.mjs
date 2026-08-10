import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMENT_MARKER } from '../src/markdown.mjs'
import { GitHubApiError, upsertComment } from '../src/github.mjs'

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return data === undefined ? '' : JSON.stringify(data)
    },
  }
}

test('updates an existing sticky comment owned by github-actions', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    if (String(url).endsWith('/user')) return response(403, { message: 'Resource not accessible by integration' })
    if (options.method === 'GET') {
      return response(200, [{ id: 7, body: `${COMMENT_MARKER}\nold`, user: { login: 'github-actions[bot]', type: 'Bot' } }])
    }
    return response(200, { id: 7, html_url: 'https://github.com/example/repo/pull/1#issuecomment-7' })
  }

  const result = await upsertComment({
    fetchImpl,
    apiUrl: 'https://api.github.com',
    token: 'secret',
    repository: 'example/repo',
    prNumber: 1,
    body: `${COMMENT_MARKER}\nnew`,
  })

  assert.equal(result.action, 'updated')
  assert.equal(calls.at(-1).options.method, 'PATCH')
  assert.match(calls.at(-1).url, /issues\/comments\/7$/)
})
test('creates a comment when no sticky comment exists', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    if (String(url).endsWith('/user')) return response(200, { login: 'automation-user' })
    if (options.method === 'GET') return response(200, [])
    return response(201, { id: 9, html_url: 'https://github.com/example/repo/pull/1#issuecomment-9' })
  }

  const result = await upsertComment({
    fetchImpl,
    apiUrl: 'https://api.github.com',
    token: 'secret',
    repository: 'example/repo',
    prNumber: 1,
    body: `${COMMENT_MARKER}\nnew`,
  })

  assert.equal(result.action, 'created')
  assert.equal(calls.at(-1).options.method, 'POST')
  assert.match(calls.at(-1).url, /issues\/1\/comments$/)
})

test('surfaces API status and message', async () => {
  const fetchImpl = async () => response(403, { message: 'Resource not accessible by integration' })
  await assert.rejects(
    upsertComment({
      fetchImpl,
      apiUrl: 'https://api.github.com',
      token: 'secret',
      repository: 'example/repo',
      prNumber: 1,
      body: 'body',
      update: false,
    }),
    (error) => error instanceof GitHubApiError && error.status === 403,
  )
})
