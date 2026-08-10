import { readFileSync } from 'node:fs'

const action = readFileSync(new URL('../action.yml', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const runtimePackage = JSON.parse(readFileSync(new URL('../runtime/package.json', import.meta.url), 'utf8'))
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const reusableWorkflow = readFileSync(new URL('../.github/workflows/calldiff.yml', import.meta.url), 'utf8')

const requiredMetadata = [
  /^name:/m,
  /^description:/m,
  /^author:/m,
  /^branding:/m,
  /^runs:/m,
  /^  using: composite$/m,
]

for (const pattern of requiredMetadata) {
  if (!pattern.test(action)) throw new Error(`action.yml is missing required metadata matching ${pattern}`)
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(runtimePackage.dependencies?.calldiff ?? '')) {
  throw new Error('runtime dependencies.calldiff must be an exact tested version')
}

const selfReference = `uses: ldub/calldiff-action@v${packageJson.version}`
if (reusableWorkflow.split(selfReference).length !== 3) {
  throw new Error(`Reusable workflow must contain exactly two immutable ${selfReference} references`)
}

for (const requiredText of ['pull-requests: write', 'fetch-depth: 2', 'calldiff-version', 'Fork pull requests']) {
  if (!readme.includes(requiredText)) throw new Error(`README.md must document ${requiredText}`)
}

process.stdout.write('Repository metadata checks passed.\n')
