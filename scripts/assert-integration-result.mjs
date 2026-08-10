import { readFileSync } from 'node:fs'

const [hasChanges, resultFile] = process.argv.slice(2)
if (hasChanges !== 'true') {
  throw new Error(`Expected has-changes=true, received ${JSON.stringify(hasChanges)}`)
}
if (!resultFile) throw new Error('Expected a result-file path')

const result = readFileSync(resultFile, 'utf8')
if (!result.includes('validateOrder')) {
  throw new Error('Expected the integration result to contain validateOrder')
}

process.stdout.write('Changed-tree integration result passed.\n')
