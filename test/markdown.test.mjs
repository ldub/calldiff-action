import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMENT_MARKER, formatComment } from '../src/markdown.mjs'

function options(overrides = {}) {
  return {
    header: '## calldiff',
    result: '+ helper()',
    warnings: '',
    status: 'success',
    version: '0.4.1',
    baseRef: 'abc123',
    headRef: 'def456',
    maxLength: 60_000,
    serverUrl: 'https://github.com',
    repository: 'ldub/example',
    runId: '42',
    ...overrides,
  }
}

test('comment includes a marker, fenced result, version, and workflow link', () => {
  const { body, truncated } = formatComment(options())
  assert.equal(truncated, false)
  assert.ok(body.startsWith(COMMENT_MARKER))
  assert.match(body, /````diff\n\+ helper\(\)\n````/)
  assert.match(body, /calldiff 0\.4\.1/)
  assert.match(body, /actions\/runs\/42/)
})

test('fence grows to contain backticks from source-derived output', () => {
  const { body } = formatComment(options({ result: 'symbol ```` value' }))
  assert.match(body, /`````diff\nsymbol ```` value\n`````/)
})

test('many source-derived backtick runs cannot exhaust the call stack', () => {
  const result = '`x'.repeat(200_000)
  const { body, truncated } = formatComment(options({ result }))
  assert.equal(truncated, true)
  assert.ok(Buffer.byteLength(body, 'utf8') <= 60_000)
})

test('oversized comments are capped and marked as truncated', () => {
  const { body, truncated } = formatComment(options({ result: 'x'.repeat(10_000), maxLength: 2_000 }))
  assert.equal(truncated, true)
  assert.ok(Buffer.byteLength(body, 'utf8') <= 2_000)
  assert.match(body, /result truncated/)
})

test('comment limits are measured in UTF-8 bytes without corrupting Unicode', () => {
  const { body, truncated } = formatComment(options({ result: 'λ🚀'.repeat(5_000), maxLength: 2_000 }))
  assert.equal(truncated, true)
  assert.ok(Buffer.byteLength(body, 'utf8') <= 2_000)
  assert.doesNotMatch(body, /�/)
})

test('warnings are visibly marked as partial analysis', () => {
  const { body } = formatComment(options({ warnings: 'warn: parser failed' }))
  assert.match(body, /analysis may be incomplete/)
  assert.match(body, /warn: parser failed/)
})
