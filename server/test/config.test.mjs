import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  resolveCodeBuddyWorkspace,
  resolveCodexWorkspace,
  resolveBackendModels,
  resolveHermesWorkspace,
  resolveOpenCodeWorkspace,
  resolveQoderWorkspace,
} from '../src/core/config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('uses the user data directory for the default OpenCode workspace', () => {
  assert.equal(
    resolveOpenCodeWorkspace({}, '/home/user/.config/qwaudio'),
    '/home/user/.config/qwaudio/workspaces/opencode',
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

test('uses the user data directory for the default Qoder workspace', () => {
  assert.equal(
    resolveQoderWorkspace({}, '/home/user/.config/qwaudio'),
    '/home/user/.config/qwaudio/workspaces/qoder',
  )
})

test('uses the user data directory for additional ACP backend workspaces', () => {
  const directory = '/home/user/.config/qwaudio'
  assert.equal(
    resolveHermesWorkspace({}, directory),
    '/home/user/.config/qwaudio/workspaces/hermes',
  )
  assert.equal(
    resolveCodeBuddyWorkspace({}, directory),
    '/home/user/.config/qwaudio/workspaces/codebuddy',
  )
  assert.equal(
    resolveCodexWorkspace({}, directory),
    '/home/user/.config/qwaudio/workspaces/codex',
  )
})

test('maps one backend model name to each managed backend provider', () => {
  assert.deepEqual(resolveBackendModels({
    QWEN_AUDIO_AGENT_BACKEND_MODEL: 'qwen3.7-plus',
  }), {
    common: 'qwen3.7-plus',
    openCode: 'alibaba-cn/qwen3.7-plus',
    openClaw: 'bailian/qwen3.7-plus',
  })
})

test('preserves backend-native model overrides', () => {
  assert.deepEqual(resolveBackendModels({
    QWEN_AUDIO_AGENT_BACKEND_MODEL: 'qwen3.7-max',
    OPENCODE_MODEL: 'custom-open/code-model',
    OPENCLAW_MODEL: 'custom-claw/model',
  }), {
    common: 'qwen3.7-max',
    openCode: 'custom-open/code-model',
    openClaw: 'custom-claw/model',
  })
})
