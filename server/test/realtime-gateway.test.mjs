import assert from 'node:assert/strict'
import test from 'node:test'
import {
  rejectUnsupportedRealtimeUpgrade,
} from '../src/voice/realtime-gateway.mjs'

test('closes websocket upgrades outside the realtime endpoint', () => {
  let destroyed = false
  const socket = {
    destroy() {
      destroyed = true
    },
  }

  assert.equal(
    rejectUnsupportedRealtimeUpgrade(socket, '/unexpected'),
    true,
  )
  assert.equal(destroyed, true)
})

test('leaves the realtime websocket upgrade for the gateway handler', () => {
  let destroyed = false
  const socket = {
    destroy() {
      destroyed = true
    },
  }

  assert.equal(
    rejectUnsupportedRealtimeUpgrade(socket, '/api/realtime'),
    false,
  )
  assert.equal(destroyed, false)
})
