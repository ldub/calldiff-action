import { appendFileSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

function escapeWorkflowData(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}
export function warning(message) {
  process.stdout.write(`::warning::${escapeWorkflowData(message)}\n`)
}

export function error(message) {
  process.stdout.write(`::error::${escapeWorkflowData(message)}\n`)
}

export function setOutput(name, value, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return
  const delimiter = `calldiff_${randomUUID()}`
  appendFileSync(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
}

export function appendSummary(markdown, summaryPath = process.env.GITHUB_STEP_SUMMARY) {
  if (!summaryPath) return
  appendFileSync(summaryPath, `${markdown}\n`)
}

export function readEvent(eventPath) {
  if (!eventPath) return {}
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'))
  } catch (cause) {
    throw new Error(`Unable to read GITHUB_EVENT_PATH: ${cause.message}`)
  }
}
