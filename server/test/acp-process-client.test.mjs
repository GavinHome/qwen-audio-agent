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
