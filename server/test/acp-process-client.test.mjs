import assert from 'node:assert/strict'
import test from 'node:test'
import { AcpProcessClient } from '../src/agent/acp-process-client.mjs'

test('shares an in-flight ACP initialization across concurrent callers', async () => {
  const client = new AcpProcessClient({
    label: 'Test Agent',
    command: 'unused',
  })
  let finishInitialization
  const initialized = {
    protocolVersion: 1,
    agentInfo: { name: 'test-agent' },
  }
  client.startProcess = () => {
    client.context = {}
    client.child = { exitCode: null }
    return new Promise(resolve => {
      finishInitialization = () => {
        client.initializeResult = initialized
        resolve(initialized)
      }
    })
  }

  const first = client.start()
  const second = client.start()
  finishInitialization()

  assert.equal(await first, initialized)
  assert.equal(await second, initialized)
})

test('pauses the prompt timeout while waiting for user permission', async () => {
  let resolvePermission
  let finishPrompt
  let promptSettled = false
  const client = new AcpProcessClient({
    label: 'Test Agent',
    command: 'unused',
    onPermission: () => new Promise(resolve => {
      resolvePermission = resolve
    }),
  })
  client.start = async () => {}
  client.context = {
    request: (_method, _params, { signal }) => new Promise(
      (resolve, reject) => {
        finishPrompt = () => resolve({ stopReason: 'end_turn' })
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      },
    ),
    notify: async () => {},
  }
  client.sessions.set('session-one', { sessionId: 'session-one' })

  const prompting = client.prompt('session-one', 'inspect project', {
    timeoutMs: 30,
  }).finally(() => {
    promptSettled = true
  })
  await new Promise(resolve => setTimeout(resolve, 10))
  const permission = client.handlePermission({
    sessionId: 'session-one',
  }, new AbortController().signal)

  await new Promise(resolve => setTimeout(resolve, 45))
  assert.equal(promptSettled, false)

  resolvePermission({ outcome: { outcome: 'selected', optionId: 'allow' } })
  await permission
  finishPrompt()
  assert.deepEqual(await prompting, {
    content: '',
    response: { stopReason: 'end_turn' },
  })
})
