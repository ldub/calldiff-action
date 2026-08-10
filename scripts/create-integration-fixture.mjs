import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const target = process.argv[2]
if (!target) throw new Error('Usage: node scripts/create-integration-fixture.mjs <target-directory>')

const directory = resolve(target)
const fixture = new URL('../fixtures/integration/', import.meta.url)
mkdirSync(directory, { recursive: true })

const git = (...args) => execFileSync('git', ['-C', directory, ...args], { stdio: 'inherit' })
git('init', '--initial-branch=main')
git('config', 'user.name', 'calldiff-action CI')
git('config', 'user.email', 'calldiff-action@users.noreply.github.com')

copyFileSync(new URL('before.ts', fixture), resolve(directory, 'flow.ts'))
git('add', 'flow.ts')
git('commit', '-m', 'fixture before')

copyFileSync(new URL('after.ts', fixture), resolve(directory, 'flow.ts'))
git('add', 'flow.ts')
git('commit', '-m', 'fixture after')
