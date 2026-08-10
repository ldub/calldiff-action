import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runComment } from '../src/comment.mjs'

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return data === undefined ? '' : JSON.stringify(data)
    },
  }
}

function files() {
  const directory = mkdtempSync(join(tmpdir(), 'calldiff-comment-test-'))
  const commentFile = join(directory, 'comment.md')
  const outputFile = join(directory, 'output.txt')
  writeFileSync(commentFile, '<!-- calldiff-action:sticky-comment -->\nresult')
  writeFileSync(outputFile, '')
  return { commentFile, outputFile }
}

function forkEvent() {
  const directory = mkdtempSync(join(tmpdir(), 'calldiff-comment-event-test-'))
  const eventFile = join(directory, 'event.json')
  writeFileSync(eventFile, JSON.stringify({
    pull_request: {
      head: { repo: { fork: true, full_name: 'contributor/repo' } },
      base: { repo: { full_name: 'example/repo' } },
      user: { login: 'contributor' },
    },
  }))
  return eventFile
}

test('disabled commenting makes no network request and reports false', async () => {
  const { commentFile, outputFile } = files()
  let requested = false
  const code = await runComment({
    env: {
      CALLDIFF_COMMENT_ENABLED: 'false',
      CALLDIFF_COMMENT_FILE: commentFile,
      GITHUB_OUTPUT: outputFile,
    },
    fetchImpl: async () => {
      requested = true
      return response(500, {})
    },
  })
  assert.equal(code, 0)
  assert.equal(requested, false)
  assert.match(readFileSync(outputFile, 'utf8'), /commented[^]*false/)
})

test('posts a generated comment through the explicit file contract', async () => {
  const { commentFile, outputFile } = files()
  const methods = []
  const code = await runComment({
    env: {
      CALLDIFF_COMMENT_ENABLED: 'true',
      CALLDIFF_COMMENT_UPDATE: 'false',
      CALLDIFF_COMMENT_TOKEN: 'secret',
      CALLDIFF_COMMENT_FILE: commentFile,
      CALLDIFF_COMMENT_PR_NUMBER: '12',
      GITHUB_REPOSITORY: 'example/repo',
      GITHUB_API_URL: 'https://api.github.com',
      GITHUB_OUTPUT: outputFile,
    },
    fetchImpl: async (_url, options) => {
      methods.push(options.method)
      return response(201, { id: 22, html_url: 'https://github.com/example/repo/pull/12#issuecomment-22' })
    },
  })
  assert.equal(code, 0)
  assert.deepEqual(methods, ['POST'])
  assert.match(readFileSync(outputFile, 'utf8'), /commented[^]*true/)
})

test('unexpected same-repository API failures fail by default', async () => {
  const { commentFile, outputFile } = files()
  const code = await runComment({
    env: {
      CALLDIFF_COMMENT_ENABLED: 'true',
      CALLDIFF_COMMENT_UPDATE: 'false',
      CALLDIFF_COMMENT_TOKEN: 'secret',
      CALLDIFF_COMMENT_FILE: commentFile,
      CALLDIFF_COMMENT_PR_NUMBER: '12',
      GITHUB_REPOSITORY: 'example/repo',
      GITHUB_OUTPUT: outputFile,
    },
    fetchImpl: async () => response(403, { message: 'Resource not accessible by integration' }),
  })
  assert.equal(code, 1)
  assert.match(readFileSync(outputFile, 'utf8'), /commented[^]*false/)
})

test('read-only fork pull request permission failures are tolerated', async () => {
  const { commentFile, outputFile } = files()
  const code = await runComment({
    env: {
      CALLDIFF_COMMENT_ENABLED: 'true',
      CALLDIFF_COMMENT_UPDATE: 'false',
      CALLDIFF_COMMENT_TOKEN: 'read-only-token',
      CALLDIFF_COMMENT_FILE: commentFile,
      CALLDIFF_COMMENT_PR_NUMBER: '12',
      GITHUB_REPOSITORY: 'example/repo',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: forkEvent(),
      GITHUB_OUTPUT: outputFile,
    },
    fetchImpl: async () => response(403, { message: 'Resource not accessible by integration' }),
  })
  assert.equal(code, 0)
  assert.match(readFileSync(outputFile, 'utf8'), /commented[^]*false/)
})

test('unexpected failures can be made non-fatal explicitly', async () => {
  const { commentFile, outputFile } = files()
  const code = await runComment({
    env: {
      CALLDIFF_COMMENT_ENABLED: 'true',
      CALLDIFF_COMMENT_FAIL_ON_ERROR: 'false',
      CALLDIFF_COMMENT_TOKEN: '',
      CALLDIFF_COMMENT_FILE: commentFile,
      CALLDIFF_COMMENT_PR_NUMBER: '12',
      GITHUB_REPOSITORY: 'example/repo',
      GITHUB_OUTPUT: outputFile,
    },
  })
  assert.equal(code, 0)
})
