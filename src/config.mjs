import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION_PATTERN = /^(?:(?:latest|next|beta|canary)|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/
const BLOCKED_EXTRA_ARGS = new Set([
  '--',
  '-h',
  '--filter-output',
  '--format',
  '--from',
  '--full-output',
  '--help',
  '--incur-update-check',
  '--json',
  '--llms',
  '--llms-full',
  '--max-depth',
  '--mcp',
  '--schema',
  '--to',
  '--token-count',
  '--token-limit',
  '--token-offset',
  '--update',
  '--version',
])

function input(env, name, fallback = '') {
  return (env[`CALLDIFF_INPUT_${name}`] ?? fallback).trim()
}

export function parseBoolean(value, name) {
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes'].includes(normalized)) return true
  if (['false', '0', 'no'].includes(normalized)) return false
  throw new Error(`${name} must be true or false, received ${JSON.stringify(value)}`)
}

export function parseInteger(value, name, { min, max }) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer, received ${JSON.stringify(value)}`)
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}, received ${parsed}`)
  }
  return parsed
}

export function parseLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function validateNames(values, name) {
  for (const value of values) {
    if (value.startsWith('-')) {
      throw new Error(`${name} values cannot start with "-": ${JSON.stringify(value)}`)
    }
    if (value.length > 4_096) {
      throw new Error(`${name} values may contain at most 4096 characters`)
    }
  }
  return values
}

export function parseExtraArgs(value) {
  let parsed
  try {
    parsed = JSON.parse(value || '[]')
  } catch (error) {
    throw new Error(`extra-args-json must be valid JSON: ${error.message}`)
  }

  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('extra-args-json must be a JSON array of strings')
  }
  if (parsed.length > 100) {
    throw new Error('extra-args-json may contain at most 100 arguments')
  }

  for (const argument of parsed) {
    const flag = argument.split('=', 1)[0]
    if (BLOCKED_EXTRA_ARGS.has(flag)) {
      throw new Error(`${flag} is managed by the action and cannot be passed through extra-args-json`)
    }
    if (argument.includes('\0') || argument.includes('\n') || argument.includes('\r')) {
      throw new Error('extra-args-json arguments cannot contain NUL bytes or newlines')
    }
  }

  return parsed
}

export function resolveCalldiffSpec(requested, actionPath) {
  if (requested === 'tested') {
    const packageJson = JSON.parse(readFileSync(join(actionPath, 'runtime', 'package.json'), 'utf8'))
    const tested = packageJson.dependencies?.calldiff
    if (typeof tested !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tested)) {
      throw new Error('runtime/package.json must contain an exact dependencies.calldiff version')
    }
    return tested
  }

  if (!VERSION_PATTERN.test(requested)) {
    throw new Error(
      `calldiff-version must be "tested", an npm dist-tag, or an exact version; received ${JSON.stringify(requested)}`,
    )
  }
  if (/^\d/.test(requested)) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(requested)
    const major = Number(match[1])
    const minor = Number(match[2])
    const patch = Number(match[3])
    if (major === 0 && (minor < 4 || (minor === 4 && patch === 0 && match[4]))) {
      throw new Error('calldiff-version must be 0.4.0 or newer; older versions do not support the action CLI contract')
    }
  }
  return requested
}

export function parseConfig(env = process.env) {
  const actionPath = env.GITHUB_ACTION_PATH
  if (!actionPath) throw new Error('GITHUB_ACTION_PATH is not set')

  const requestedVersion = input(env, 'VERSION', 'tested')
  const commentHeader = input(env, 'COMMENT_HEADER', '## calldiff')
  if (Buffer.byteLength(commentHeader, 'utf8') > 500) {
    throw new Error('comment-header may contain at most 500 UTF-8 bytes')
  }
  const testedVersion = resolveCalldiffSpec('tested', actionPath)
  const calldiffSpec = requestedVersion === 'tested'
    ? testedVersion
    : resolveCalldiffSpec(requestedVersion, actionPath)
  const useLockedRuntime = calldiffSpec === testedVersion
  const comment = parseBoolean(input(env, 'COMMENT', 'true'), 'comment')
  if (comment && !useLockedRuntime) {
    throw new Error(
      'comment=true requires calldiff-version=tested (or the same exact tested version). Set comment=false to test an unlocked npm version without exposing a write-capable token in the same job.',
    )
  }

  return {
    actionPath,
    requestedVersion,
    calldiffSpec,
    useLockedRuntime,
    baseRef: input(env, 'BASE_REF'),
    headRef: input(env, 'HEAD_REF'),
    prNumber: input(env, 'PR_NUMBER')
      ? parseInteger(input(env, 'PR_NUMBER'), 'pr-number', { min: 1, max: 2_147_483_647 })
      : undefined,
    workingDirectory: input(env, 'WORKING_DIRECTORY', '.'),
    paths: validateNames(parseLines(input(env, 'PATHS')), 'paths'),
    entrypoints: validateNames(parseLines(input(env, 'ENTRYPOINTS')), 'entrypoints'),
    maxDepth: parseInteger(input(env, 'MAX_DEPTH', '12'), 'max-depth', { min: 1, max: 100 }),
    extraArgs: parseExtraArgs(input(env, 'EXTRA_ARGS_JSON', '[]')),
    comment,
    commentHeader,
    maxCommentLength: parseInteger(
      input(env, 'MAX_COMMENT_LENGTH', '60000'),
      'max-comment-length',
      { min: 2_000, max: 65_000 },
    ),
    failOnError: parseBoolean(input(env, 'FAIL_ON_ERROR', 'true'), 'fail-on-error'),
    failOnWarnings: parseBoolean(input(env, 'FAIL_ON_WARNINGS', 'false'), 'fail-on-warnings'),
    timeoutSeconds: parseInteger(input(env, 'TIMEOUT_SECONDS', '300'), 'timeout-seconds', {
      min: 10,
      max: 3_600,
    }),
  }
}
