import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  applyBackendPermissionMode,
  resolveManagedBackend,
  startManagedBackend,
} from '../src/process/managed-backend.mjs'

function childProcess() {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.pid = 4242
  child.kill = signal => {
    child.signalCode = signal
  }
  return child
}

test('compatible mode never starts a backend process', async () => {
  let spawned = false
  const runtime = await startManagedBackend({
    root: '/repo',
    env: {
      AGENT_PROTOCOL: 'opencode',
      QWEN_AUDIO_AGENT_BACKEND_MODE: 'compatible',
      OPENCODE_BASE_URL: 'http://127.0.0.1:4096',
    },
    spawnImpl: () => {
      spawned = true
    },
  })
  assert.equal(runtime.ownsProcess, false)
  assert.equal(spawned, false)
})

test('managed mode owns one backend and moves away from occupied ports', async () => {
  const env = {
    AGENT_PROTOCOL: 'openclaw',
    QWEN_AUDIO_AGENT_BACKEND_MODE: 'managed',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
  }
  const calls = []
  const child = childProcess()
  const signals = []
  const runtime = await startManagedBackend({
    root: '/repo',
    env,
    platform: 'darwin',
    isAddressInUse: async () => true,
    findFreeAddress: async () => 'http://127.0.0.1:45678',
    spawnImpl: (...args) => {
      calls.push(args)
      return child
    },
  })
  runtime.killImpl = (pid, signal) => signals.push([pid, signal])
  assert.equal(env.OPENCLAW_BASE_URL, 'http://127.0.0.1:45678')
  assert.equal(env.OPENCLAW_PORT, '45678')
  assert.equal(calls[0][0], '/repo/scripts/backend')
  assert.equal(calls[0][2].env.QWEN_AUDIO_AGENT_ENV_LOADED, '1')
  runtime.close()
  assert.deepEqual(signals, [[-4242, 'SIGTERM']])
})

test('normalizes the selected backend', () => {
  assert.deepEqual(resolveManagedBackend({
    AGENT_PROTOCOL: 'opencode',
    OPENCODE_BASE_URL: 'http://localhost:4096/path',
  }), {
    protocol: 'opencode',
    mode: 'managed',
    permissionMode: 'native',
    baseUrl: 'http://localhost:4096',
  })
})

test('Qoder is managed inside the Gateway without a separate server', async () => {
  assert.deepEqual(resolveManagedBackend({
    AGENT_PROTOCOL: 'qoder',
  }), {
    protocol: 'qoder',
    mode: 'managed',
    permissionMode: 'native',
    baseUrl: null,
  })
  const runtime = await startManagedBackend({
    root: '/repo',
    env: { AGENT_PROTOCOL: 'qoder' },
    spawnImpl: () => {
      throw new Error('Qoder must not spawn a separate backend server')
    },
  })
  assert.equal(runtime.ownsProcess, false)
  assert.throws(
    () => resolveManagedBackend({
      AGENT_PROTOCOL: 'qoder',
      QWEN_AUDIO_AGENT_BACKEND_MODE: 'compatible',
    }),
    /只支持 managed/,
  )
})

test('full permission mode configures managed OpenCode without discarding inline config', () => {
  const env = {
    AGENT_PROTOCOL: 'opencode',
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: 'full',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      theme: 'system',
      agent: {
        build: { model: 'provider/model', permission: 'ask' },
      },
    }),
  }
  const backend = resolveManagedBackend(env)
  applyBackendPermissionMode(env, backend)
  const inline = JSON.parse(env.OPENCODE_CONFIG_CONTENT)
  assert.equal(backend.permissionMode, 'full')
  assert.equal(inline.theme, 'system')
  assert.equal(inline.permission, 'allow')
  assert.equal(inline.agent.build.model, 'provider/model')
  assert.equal(inline.agent.build.permission, 'allow')
  assert.equal(
    inline.agent['qwen-audio-agent-backend'].permission,
    'allow',
  )
})

test('full permission mode rejects backends that cannot support it safely', () => {
  assert.throws(() => resolveManagedBackend({
    AGENT_PROTOCOL: 'opencode',
    QWEN_AUDIO_AGENT_BACKEND_MODE: 'compatible',
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: 'full',
  }), /只支持由 Gateway 管理/)
  assert.throws(() => resolveManagedBackend({
    AGENT_PROTOCOL: 'openclaw',
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: 'full',
  }), /OpenClaw/)
})
