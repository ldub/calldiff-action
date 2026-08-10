import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCalldiffArgs,
  detectChanges,
  normalizeWarnings,
  parseCalldiffOutput,
  runCommand,
} from '../src/process.mjs'
import { childProcessEnvironment } from '../src/main.mjs'

test('calldiff arguments are passed as an array with wrapper-owned structured output', () => {
  assert.deepEqual(
    buildCalldiffArgs({
      cliPath: '/tmp/calldiff/dist/cli.js',
      baseRef: 'base sha',
      headRef: 'head sha',
      paths: ['path with spaces'],
      entrypoints: ['App.start', 'worker'],
      maxDepth: 8,
      extraArgs: ['--future-flag'],
    }),
    [
      '/tmp/calldiff/dist/cli.js',
      'diff',
      'base sha',
      'head sha',
      'path with spaces',
      '--entry',
      'App.start',
      '--entry',
      'worker',
      '--future-flag',
      '--max-depth',
      '8',
      '--format',
      'json',
      '--filter-output',
      'message,ascii',
    ],
  )
})

test('filtered JSON output is parsed as a string', () => {
  assert.deepEqual(parseCalldiffOutput('"line one\\n+ line two"\n'), { ascii: 'line one\n+ line two', message: '' })
  assert.deepEqual(parseCalldiffOutput('{"ascii":"fallback"}'), { ascii: 'fallback', message: '' })
  assert.deepEqual(
    parseCalldiffOutput('{"message":"No callstack changes between a and b.","ascii":"same"}'),
    { ascii: 'same', message: 'No callstack changes between a and b.' },
  )
  assert.throws(() => parseCalldiffOutput('  \n'), /empty structured output/)
  assert.throws(() => parseCalldiffOutput('{"trees":[]}'), /without an ascii field/)
})

test('change and warning detection are explicit', () => {
  assert.equal(detectChanges('No callstack changes between a and b.', 0), 'false')
  assert.equal(detectChanges('', 0), 'true')
  assert.equal(detectChanges('', 1), 'unknown')
  assert.equal(detectChanges('', 0), 'true', 'ASCII content cannot create a false no-change result')
  assert.equal(
    normalizeWarnings('notice: scanning\nwarn: failed to parse one.ts @ HEAD: bad grammar\n  npm detail\n'),
    'notice: scanning\nwarn: failed to parse one.ts @ HEAD: bad grammar\n  npm detail',
  )
})

test('runCommand does not invoke a shell', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', '$(echo unsafe)'])
  assert.equal(result.code, 0)
  assert.equal(result.stdout, '$(echo unsafe)')
})

test('timeout terminates descendants that keep command pipes open', async () => {
  const script = [
    "const { spawn } = require('node:child_process')",
    "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], { stdio: ['ignore', 'inherit', 'inherit'] })",
    'setTimeout(() => {}, 2000)',
  ].join(';')
  const started = Date.now()
  const result = await runCommand(process.execPath, ['-e', script], { timeoutMs: 100 })
  assert.equal(result.timedOut, true)
  assert.ok(Date.now() - started < 1_500, 'the descendant should be terminated with its process group')
})

test('npm and calldiff child processes do not inherit workflow secrets', () => {
  const child = childProcessEnvironment({
    PATH: '/safe/bin',
    HOME: '/safe/home',
    GITHUB_TOKEN: 'github-secret',
    CALLDIFF_INPUT_TOKEN: 'comment-secret',
    MY_DEPLOYMENT_SECRET: 'other-secret',
  })
  assert.deepEqual(child, { PATH: '/safe/bin', HOME: '/safe/home' })
})
