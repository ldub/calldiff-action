#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseBoolean } from './config.mjs'
import { GitHubApiError, upsertComment } from './github.mjs'
import { COMMENT_MARKER } from './markdown.mjs'
import { error, readEvent, setOutput, warning } from './workflow.mjs'

function outputs(values, env) {
  for (const [name, value] of Object.entries(values)) {
    setOutput(name, String(value ?? ''), env.GITHUB_OUTPUT)
  }
}

function isReadOnlyPullRequest(env) {
  if (env.GITHUB_EVENT_NAME && env.GITHUB_EVENT_NAME !== 'pull_request') return false

  let event
  try {
    event = readEvent(env.GITHUB_EVENT_PATH)
  } catch {
    return false
  }
  const pullRequest = event.pull_request
  if (!pullRequest) return false

  const headRepository = pullRequest.head?.repo
  const baseRepository = pullRequest.base?.repo
  const differentRepository = headRepository?.id != null && baseRepository?.id != null
    ? headRepository.id !== baseRepository.id
    : Boolean(
      headRepository?.full_name
      && baseRepository?.full_name
      && headRepository.full_name.toLowerCase() !== baseRepository.full_name.toLowerCase(),
    )
  return differentRepository
    || pullRequest.user?.login === 'dependabot[bot]'
    || env.GITHUB_ACTOR === 'dependabot[bot]'
    || event.sender?.login === 'dependabot[bot]'
}

export async function runComment({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const defaults = { 'comment-id': '', 'comment-url': '', commented: false }
  let enabled
  let update
  let failOnError
  try {
    enabled = parseBoolean(env.CALLDIFF_COMMENT_ENABLED || 'true', 'comment')
    update = parseBoolean(env.CALLDIFF_COMMENT_UPDATE || 'true', 'update-comment')
    failOnError = parseBoolean(env.CALLDIFF_COMMENT_FAIL_ON_ERROR || 'true', 'fail-on-comment-error')
  } catch (cause) {
    outputs(defaults, env)
    error(cause.message)
    return 1
  }

  if (!enabled) {
    outputs(defaults, env)
    return 0
  }

  const token = env.CALLDIFF_COMMENT_TOKEN || ''
  const commentFile = env.CALLDIFF_COMMENT_FILE || ''
  const repository = env.GITHUB_REPOSITORY || ''
  const prNumber = Number.parseInt(env.CALLDIFF_COMMENT_PR_NUMBER || '', 10)
  const apiUrl = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '')
  const readOnlyPullRequest = isReadOnlyPullRequest(env)

  const fail = (message, { expectedReadOnly = false } = {}) => {
    outputs(defaults, env)
    if ((expectedReadOnly && readOnlyPullRequest) || !failOnError) {
      warning(message)
      return 0
    }
    error(message)
    return 1
  }

  if (!token) {
    return fail('No GitHub token is available, so the pull request comment was skipped', {
      expectedReadOnly: true,
    })
  }
  if (!commentFile || !repository || !Number.isSafeInteger(prNumber) || prNumber < 1) {
    return fail('No pull request context is available, so the pull request comment was skipped')
  }

  let body
  try {
    body = readFileSync(commentFile, 'utf8')
  } catch (cause) {
    return fail(`Unable to read the generated calldiff comment: ${cause.message}`)
  }
  if (!body.startsWith(COMMENT_MARKER) || Buffer.byteLength(body, 'utf8') > 65_000) {
    return fail('The generated calldiff comment failed marker or size validation and was not posted')
  }

  try {
    const response = await upsertComment({
      fetchImpl,
      apiUrl,
      token,
      repository,
      prNumber,
      body,
      update,
    })
    const values = {
      'comment-id': response.comment.id ?? '',
      'comment-url': response.comment.html_url ?? '',
      commented: true,
    }
    outputs(values, env)
    process.stdout.write(`${response.action === 'updated' ? 'Updated' : 'Created'} calldiff comment${values['comment-url'] ? `: ${values['comment-url']}` : ''}\n`)
    return 0
  } catch (cause) {
    if (cause instanceof GitHubApiError && cause.status === 403) {
      const message = readOnlyPullRequest
        ? 'GitHub did not grant permission to comment. This is expected for pull requests from forks and Dependabot; the result is still in the job summary.'
        : 'GitHub denied permission to comment. Verify pull-requests: write and the configured token.'
      return fail(
        message,
        { expectedReadOnly: true },
      )
    }
    return fail(`Unable to create or update the pull request comment: ${cause.message}`)
  }
}

function isMainModule() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  runComment()
    .then((code) => {
      process.exitCode = code
    })
    .catch((cause) => {
      error(cause instanceof Error ? cause.message : String(cause))
      process.exitCode = 1
    })
}
