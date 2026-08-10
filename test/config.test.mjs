import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseConfig, parseExtraArgs, resolveCalldiffSpec } from '../src/config.mjs'

function actionDirectory(version = '1.2.3') {
  const directory = mkdtempSync(join(tmpdir(), 'calldiff-config-test-'))
  const runtime = join(directory, 'runtime')
  mkdirSync(runtime)
  writeFileSync(join(runtime, 'package.json'), JSON.stringify({ dependencies: { calldiff: version } }))
  return directory
}

test('tested resolves to the exact development dependency', () => {
  assert.equal(resolveCalldiffSpec('tested', actionDirectory('0.4.1')), '0.4.1')
})

test('configuration parses multiline lists and booleans', () => {
  const config = parseConfig({
    GITHUB_ACTION_PATH: actionDirectory(),
    CALLDIFF_INPUT_VERSION: 'latest',
    CALLDIFF_INPUT_COMMENT: 'false',
    CALLDIFF_INPUT_PATHS: 'src\npackages/api\n',
    CALLDIFF_INPUT_ENTRYPOINTS: 'App.start\nworker',
    CALLDIFF_INPUT_MAX_DEPTH: '8',
    CALLDIFF_INPUT_EXTRA_ARGS_JSON: '["--future-option", "value with spaces"]',
    CALLDIFF_INPUT_FAIL_ON_ERROR: 'true',
    CALLDIFF_INPUT_FAIL_ON_WARNINGS: 'false',
    CALLDIFF_INPUT_MAX_COMMENT_LENGTH: '5000',
    CALLDIFF_INPUT_TIMEOUT_SECONDS: '60',
  })

  assert.equal(config.calldiffSpec, 'latest')
  assert.deepEqual(config.paths, ['src', 'packages/api'])
  assert.deepEqual(config.entrypoints, ['App.start', 'worker'])
  assert.deepEqual(config.extraArgs, ['--future-option', 'value with spaces'])
  assert.equal(config.maxDepth, 8)
  assert.equal(config.useLockedRuntime, false)
  assert.equal(config.comment, false)
})

test('commenting requires the reviewed locked calldiff runtime', () => {
  const directory = actionDirectory('0.4.1')
  assert.throws(
    () => parseConfig({
      GITHUB_ACTION_PATH: directory,
      CALLDIFF_INPUT_VERSION: 'latest',
      CALLDIFF_INPUT_COMMENT: 'true',
    }),
    /comment=true requires calldiff-version=tested/,
  )
  assert.equal(parseConfig({
    GITHUB_ACTION_PATH: directory,
    CALLDIFF_INPUT_VERSION: '0.4.1',
    CALLDIFF_INPUT_COMMENT: 'true',
  }).useLockedRuntime, true)
})

test('extra arguments cannot override wrapper-owned output flags', () => {
  assert.throws(() => parseExtraArgs('["--format=json"]'), /managed by the action/)
  assert.throws(() => parseExtraArgs('["-h"]'), /managed by the action/)
  assert.throws(() => parseExtraArgs('{"flag": true}'), /JSON array of strings/)
})

test('paths and entrypoints cannot be reinterpreted as CLI flags', () => {
  assert.throws(
    () => parseConfig({ GITHUB_ACTION_PATH: actionDirectory(), CALLDIFF_INPUT_PATHS: '--help' }),
    /paths values cannot start/,
  )
})

test('versions are restricted to exact versions and npm dist-tags', () => {
  const directory = actionDirectory()
  assert.equal(resolveCalldiffSpec('0.5.0-beta.1', directory), '0.5.0-beta.1')
  assert.equal(resolveCalldiffSpec('next', directory), 'next')
  assert.throws(() => resolveCalldiffSpec('0.3.0', directory), /0\.4\.0 or newer/)
  assert.throws(() => resolveCalldiffSpec('0.4.0-beta.1', directory), /0\.4\.0 or newer/)
  assert.throws(() => resolveCalldiffSpec('experimental', directory), /must be/)
  assert.throws(() => resolveCalldiffSpec('https://example.com/package.tgz', directory), /must be/)
  assert.throws(() => resolveCalldiffSpec('../local-package', directory), /must be/)
})
