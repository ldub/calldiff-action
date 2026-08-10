import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const MAX_CAPTURE_BYTES = 32 * 1024 * 1024

export class CommandError extends Error {
  constructor(message, result) {
    super(message)
    this.name = 'CommandError'
    this.result = result
  }
}

export function runCommand(command, args, options = {}) {
  const {
    cwd,
    env = process.env,
    timeoutMs = 300_000,
    maxCaptureBytes = MAX_CAPTURE_BYTES,
  } = options

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      shell: false,
      windowsHide: true,
    })

    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let exceededCaptureLimit = false
    let forceKillTimer

    const signalTree = (signal) => {
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signal)
          return
        } catch {
          // Fall through if the process group has already disappeared.
        }
      }
      if (process.platform === 'win32' && signal === 'SIGKILL' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        })
        killer.unref()
      }
      child.kill(signal)
    }

    const terminate = () => {
      signalTree('SIGTERM')
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => signalTree('SIGKILL'), 5_000)
        forceKillTimer.unref?.()
      }
    }

    const capture = (chunks, chunk, stream) => {
      if (stream === 'stdout') stdoutBytes += chunk.length
      else stderrBytes += chunk.length

      if (stdoutBytes + stderrBytes > maxCaptureBytes) {
        exceededCaptureLimit = true
        terminate()
        return
      }
      chunks.push(chunk)
    }

    child.stdout.on('data', (chunk) => capture(stdout, chunk, 'stdout'))
    child.stderr.on('data', (chunk) => capture(stderr, chunk, 'stderr'))
    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, timeoutMs)

    child.on('error', (cause) => {
      clearTimeout(timer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      reject(cause)
    })

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      const result = {
        code: code ?? 1,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        exceededCaptureLimit,
      }
      resolve(result)
    })
  })
}

export async function findRepositoryRoot(candidate, options = {}) {
  const result = await runCommand('git', ['-C', candidate, 'rev-parse', '--show-toplevel'], options)
  if (result.code !== 0) {
    throw new CommandError(`No checked-out Git repository found at ${candidate}`, result)
  }
  return result.stdout.trim()
}

export async function verifyGitRef(repositoryRoot, ref, options = {}) {
  if (!ref || ref.startsWith('-') || /[\0\r\n]/.test(ref)) {
    throw new Error(`Invalid git ref: ${JSON.stringify(ref)}`)
  }

  const result = await runCommand('git', ['cat-file', '-e', `${ref}^{commit}`], {
    ...options,
    cwd: repositoryRoot,
  })
  if (result.code !== 0) {
    throw new CommandError(
      `Git ref ${ref} is not available locally. Check out the pull request with fetch-depth: 2 (or 0).`,
      result,
    )
  }
}

function assertSupportedVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
  if (!match) throw new Error(`calldiff returned an invalid version: ${JSON.stringify(version)}`)
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (major === 0 && (minor < 4 || (minor === 4 && patch === 0 && match[4]))) {
    throw new Error(`calldiff ${version} is unsupported; calldiff-action requires 0.4.0 or newer`)
  }
}

function resolveCli(packageRoot, packageJson) {
  const declared = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.calldiff
  if (typeof declared !== 'string' || !declared) {
    throw new Error('The installed calldiff package does not declare a calldiff executable')
  }

  const cliPath = resolve(packageRoot, declared)
  const pathFromPackage = relative(packageRoot, cliPath)
  if (isAbsolute(pathFromPackage) || pathFromPackage === '..' || pathFromPackage.startsWith(`..${sep}`)) {
    throw new Error('The installed calldiff package declared an executable outside its package directory')
  }
  if (!existsSync(cliPath)) {
    throw new Error('The installed calldiff package did not contain its declared executable')
  }
  const realPackageRoot = realpathSync(packageRoot)
  const realCliPath = realpathSync(cliPath)
  const realPathFromPackage = relative(realPackageRoot, realCliPath)
  if (isAbsolute(realPathFromPackage) || realPathFromPackage === '..' || realPathFromPackage.startsWith(`..${sep}`)) {
    throw new Error('The installed calldiff executable resolves outside its package directory')
  }
  return realCliPath
}

export async function installCalldiff({ spec, tested, actionPath, runnerTemp, env, timeoutMs }) {
  const installDirectory = mkdtempSync(join(runnerTemp, 'calldiff-action-'))
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  let args

  if (tested) {
    copyFileSync(join(actionPath, 'runtime', 'package.json'), join(installDirectory, 'package.json'))
    copyFileSync(join(actionPath, 'runtime', 'package-lock.json'), join(installDirectory, 'package-lock.json'))
    args = ['ci', '--no-audit', '--no-fund', '--omit=dev', '--prefix', installDirectory]
  } else {
    args = [
      'install',
      '--no-save',
      '--package-lock=false',
      '--no-audit',
      '--no-fund',
      '--omit=dev',
      '--prefix',
      installDirectory,
      `calldiff@${spec}`,
    ]
  }

  const result = await runCommand(
    npm,
    args,
    { cwd: installDirectory, env, timeoutMs },
  )

  if (result.code !== 0) {
    throw new CommandError(`Unable to install calldiff@${spec}`, result)
  }

  const packageRoot = join(installDirectory, 'node_modules', 'calldiff')
  const packagePath = join(packageRoot, 'package.json')
  if (!existsSync(packagePath)) throw new Error(`calldiff@${spec} was not installed`)

  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (packageJson.name !== 'calldiff' || typeof packageJson.version !== 'string') {
    throw new Error(`calldiff@${spec} did not contain a valid package version`)
  }
  assertSupportedVersion(packageJson.version)
  const cliPath = resolveCli(packageRoot, packageJson)

  return { installDirectory, cliPath, version: packageJson.version, npmResult: result }
}

export function buildCalldiffArgs({
  cliPath,
  baseRef,
  headRef,
  paths,
  entrypoints,
  maxDepth,
  extraArgs,
}) {
  const args = [cliPath, 'diff', baseRef, headRef, ...paths]
  for (const entrypoint of entrypoints) args.push('--entry', entrypoint)
  args.push(...extraArgs)
  args.push('--max-depth', String(maxDepth))

  // The wrapper owns the output format so it can safely parse and fence the
  // result without serializing calldiff's much larger nested tree structure.
  args.push('--format', 'json', '--filter-output', 'message,ascii')
  return args
}

export function parseCalldiffOutput(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('calldiff returned empty structured output')

  const parsed = JSON.parse(trimmed)
  if (typeof parsed === 'string') return { ascii: parsed, message: '' }
  if (parsed && typeof parsed.ascii === 'string') {
    return { ascii: parsed.ascii, message: typeof parsed.message === 'string' ? parsed.message : '' }
  }
  throw new Error('calldiff returned structured output without an ascii field')
}

export function detectChanges(message, exitCode) {
  if (exitCode !== 0) return 'unknown'
  return /^No callstack changes\b/.test(message) ? 'false' : 'true'
}

export function normalizeWarnings(stderr) {
  const normalized = stderr.trim()
  return /(?:^|\n)warn: failed to parse\b/i.test(normalized) ? normalized : ''
}
