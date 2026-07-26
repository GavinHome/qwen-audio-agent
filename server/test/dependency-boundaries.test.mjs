import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const sharedRoot = resolve(sourceRoot, '../../shared')
const allowedDependencies = {
  app: new Set(['agent', 'app', 'conversation', 'core', 'task', 'voice']),
  process: new Set(['process']),
  core: new Set(['core', 'shared']),
  agent: new Set(['agent', 'core']),
  conversation: new Set(['conversation', 'core']),
  task: new Set(['agent', 'core', 'task']),
  voice: new Set(['conversation', 'core', 'task', 'voice']),
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : [path]
  }).filter(path => path.endsWith('.mjs'))
}

function layerFor(path) {
  const sharedPath = relative(sharedRoot, path)
  if (sharedPath !== '..' && !sharedPath.startsWith(`..${sep}`)) return 'shared'
  const first = relative(sourceRoot, path).split(sep)[0]
  return first.endsWith('.mjs') ? 'root' : first
}

test('server source dependencies follow the documented layer direction', () => {
  const violations = []
  for (const file of sourceFiles(sourceRoot)) {
    const sourceLayer = layerFor(file)
    const imports = [
      ...readFileSync(file, 'utf8').matchAll(
        /(?:from\s+|import\s+)['"](\.{1,2}\/[^'"]+\.mjs)['"]/g,
      ),
    ]
    for (const match of imports) {
      const target = resolve(dirname(file), match[1])
      const targetLayer = layerFor(target)
      if (
        sourceLayer === 'root'
          ? !new Set(['app', 'process', 'shared']).has(targetLayer)
          : !allowedDependencies[sourceLayer]?.has(targetLayer)
      ) {
        violations.push(
          `${relative(sourceRoot, file)} -> ${relative(sourceRoot, target)}`,
        )
      }
    }
  }
  assert.deepEqual(violations, [])
})
