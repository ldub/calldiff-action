#!/usr/bin/env node

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { parseConfig } from './config.mjs'
import { COMMENT_MARKER, formatComment, sanitizeUntrustedText, truncateUtf8 } from './markdown.mjs'
import {
  CommandError,
  buildCalldiffArgs,
  detectChanges,
  findRepositoryRoot,
  installCalldiff,
  normalizeWarnings,
  parseCalldiffOutput,
  runCommand,
  verifyGitRef,
} from './process.mjs'
import { appendSummary, error, readEvent, setOutput, warning } from './workflow.mjs'

function eventContext(config, env, event) {
  const pullRequest = event.pull_request
  const baseRef = config.baseRef || pullRequest?.base?.sha
  const headRef = config.headRef || pullRequest?.head?.sha
  const prNumber = config.prNumber || event.number || pullRequest?.number

  if (!baseRef || !headRef) {
    throw new Error('base-ref and head-ref are required outside a pull_request event')
  }

  const workspace = env.GITHUB_WORKSPACE || process.cwd()
  const candidate = isAbsolute(config.workingDirectory)
    ? config.workingDirectory
    : resolve(workspace, config.workingDirectory)

  return {
    baseRef,
    headRef,
    prNumber,
    candidate,
    repository: env.GITHUB_REPOSITORY || '',
    serverUrl: (env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, ''),
    runId: env.GITHUB_RUN_ID || '',
  }
}

function commandFailureDetails(cause) {
  if (!(cause instanceof CommandError)) return cause.message
  const details = [cause.message]
  const stderr = cause.result?.stderr?.trim()
  const stdout = cause.result?.stdout?.trim()
  if (stdout) details.push(`stdout:\n${stdout}`)
  if (stderr) details.push(`stderr:\n${stderr}`)
  if (cause.result?.timedOut) details.push('The command timed out.')
  if (cause.result?.exceededCaptureLimit) details.push('The command produced more than 32 MiB of output.')
  return details.join('\n\n')
}

function fullResultFile({ result, warnings: warningText, version, baseRef, headRef, status }) {
  const sections = [
    `status: ${status}`,
    `calldiff-version: ${version || 'unknown'}`,
    `base-ref: ${baseRef}`,
    `head-ref: ${headRef}`,
    '',
    result,
  ]
  if (warningText) sections.push('', 'warnings:', warningText)
  return `${sections.join('\n')}\n`
}

function summaryFromComment(body) {
  return body.startsWith(`${COMMENT_MARKER}\n`) ? body.slice(COMMENT_MARKER.length + 1) : body
}

function logResult(result, warningText) {
  process.stdout.write('::group::calldiff result\n')
  const safeResult = sanitizeUntrustedText(result).replace(/^::/gm, '\u200b::')
  const safeLog = truncateUtf8(safeResult, 100_000)
  process.stdout.write(`${safeLog}${safeLog.length < safeResult.length ? '\n… log output truncated; use result-file for the complete result …' : ''}\n`)
  process.stdout.write('::endgroup::\n')
  if (warningText) warning('calldiff emitted warnings; the analysis may be incomplete')
}

function setCommonOutputs(values, env) {
  const outputPath = env.GITHUB_OUTPUT
  for (const [name, value] of Object.entries(values)) setOutput(name, String(value ?? ''), outputPath)
}

export async function runAction({ env = process.env } = {}) {
  let config
  try {
    config = parseConfig(env)
  } catch (cause) {
    error(cause.message)
    return 1
  }

  let context
  try {
    context = eventContext(config, env, readEvent(env.GITHUB_EVENT_PATH))
  } catch (cause) {
    error(cause.message)
    return 1
  }

  const timeoutMs = config.timeoutSeconds * 1_000
  const runnerTemp = env.RUNNER_TEMP || tmpdir()
  const commandEnv = childProcessEnvironment(env)
  Object.assign(commandEnv, {
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    CALLDIFF_GRAMMAR_CACHE: mkdtempSync(join(runnerTemp, 'calldiff-action-grammars-')),
  })
  mkdirSync(commandEnv.CALLDIFF_GRAMMAR_CACHE, { recursive: true })

  let status = 'success'
  let exitCode = 0
  let result = ''
  let resultMessage = ''
  let warningText = ''
  let version = config.calldiffSpec
  let resultDirectory

  try {
    const repositoryRoot = await findRepositoryRoot(context.candidate, {
      env: commandEnv,
      timeoutMs,
    })
    await verifyGitRef(repositoryRoot, context.baseRef, { env: commandEnv, timeoutMs })
    await verifyGitRef(repositoryRoot, context.headRef, { env: commandEnv, timeoutMs })

    process.stdout.write(`Installing calldiff@${config.calldiffSpec}…\n`)
    const installed = await installCalldiff({
      spec: config.calldiffSpec,
      tested: config.useLockedRuntime,
      actionPath: config.actionPath,
      runnerTemp,
      env: commandEnv,
      timeoutMs,
    })
    resultDirectory = installed.installDirectory
    version = installed.version

    const args = buildCalldiffArgs({
      cliPath: installed.cliPath,
      baseRef: context.baseRef,
      headRef: context.headRef,
      paths: config.paths,
      entrypoints: config.entrypoints,
      maxDepth: config.maxDepth,
      extraArgs: config.extraArgs,
    })
    process.stdout.write(`Running calldiff ${version} from ${context.baseRef} to ${context.headRef}…\n`)
    const execution = await runCommand(process.execPath, args, {
      cwd: repositoryRoot,
      env: commandEnv,
      timeoutMs,
    })
    exitCode = execution.code
    warningText = normalizeWarnings(execution.stderr)

    if (execution.code !== 0) {
      throw new CommandError(`calldiff exited with code ${execution.code}`, execution)
    }

    try {
      const parsed = parseCalldiffOutput(execution.stdout)
      result = parsed.ascii
      resultMessage = parsed.message
    } catch (cause) {
      throw new CommandError(`Unable to parse calldiff output: ${cause.message}`, { ...execution, code: 1 })
    }
  } catch (cause) {
    status = 'error'
    exitCode = cause instanceof CommandError ? cause.result?.code ?? 1 : 1
    result = commandFailureDetails(cause)
  }

  if (!resultDirectory) resultDirectory = mkdtempSync(join(runnerTemp, 'calldiff-action-result-'))
  result = sanitizeUntrustedText(result)
  warningText = sanitizeUntrustedText(warningText)
  const resultFile = join(resultDirectory, 'calldiff-result.txt')
  writeFileSync(
    resultFile,
    fullResultFile({
      result,
      warnings: warningText,
      version,
      baseRef: context.baseRef,
      headRef: context.headRef,
      status,
    }),
  )

  logResult(result, warningText)
  const formatted = formatComment({
    header: config.commentHeader,
    result,
    warnings: warningText,
    status,
    version,
    baseRef: context.baseRef,
    headRef: context.headRef,
    maxLength: config.maxCommentLength,
    serverUrl: context.serverUrl,
    repository: context.repository,
    runId: context.runId,
  })
  appendSummary(summaryFromComment(formatted.body), env.GITHUB_STEP_SUMMARY)
  const commentFile = join(resultDirectory, 'calldiff-comment.md')
  writeFileSync(commentFile, formatted.body)

  const hasWarnings = Boolean(warningText)
  setCommonOutputs(
    {
      'calldiff-version': version,
      'exit-code': exitCode,
      'has-changes': detectChanges(resultMessage, exitCode),
      'has-warnings': hasWarnings,
      'result-file': resultFile,
      'comment-file': commentFile,
      'comment-enabled': config.comment,
      'pr-number': context.prNumber || '',
      truncated: formatted.truncated,
    },
    env,
  )

  const shouldFail = (status === 'error' && config.failOnError) || (hasWarnings && config.failOnWarnings)
  if (shouldFail) {
    error(status === 'error' ? 'calldiff could not complete' : 'calldiff emitted warnings')
    return 1
  }
  return 0
}

export function childProcessEnvironment(env) {
  const safeNames = new Set([
    'CI',
    'ComSpec',
    'COMSPEC',
    'GITHUB_ACTIONS',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'LANG',
    'LC_ALL',
    'NODE_EXTRA_CA_CERTS',
    'NO_PROXY',
    'no_proxy',
    'Path',
    'PATH',
    'PATHEXT',
    'RUNNER_ARCH',
    'RUNNER_OS',
    'RUNNER_TEMP',
    'SHELL',
    'SSL_CERT_FILE',
    'SystemRoot',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USERPROFILE',
    'WINDIR',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'http_proxy',
    'https_proxy',
  ])
  return Object.fromEntries(Object.entries(env).filter(([name]) => safeNames.has(name) || name.startsWith('LC_')))
}

function isMainModule() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isMainModule()) {
  runAction()
    .then((code) => {
      process.exitCode = code
    })
    .catch((cause) => {
      error(cause instanceof Error ? cause.message : String(cause))
      process.exitCode = 1
    })
}
