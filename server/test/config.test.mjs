import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveOpenCodeWorkspace } from '../src/core/config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('uses the repository OpenCode workspace by default', () => {
  assert.equal(
    resolveOpenCodeWorkspace({}),
    resolve(root, 'config/opencode-workspace'),
  )
})

test('uses only the explicit OPENCODE_WORKSPACE setting', () => {
  assert.equal(
    resolveOpenCodeWorkspace({
      OPENCODE_WORKSPACE: 'projects/voice',
      OPENCODE_DIRECTORY: 'legacy',
    }),
    resolve(root, 'projects/voice'),
  )
})
