import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
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
    baseUrl: 'http://localhost:4096',
  })
})
