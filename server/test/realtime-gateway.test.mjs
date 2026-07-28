import assert from 'node:assert/strict'
import test from 'node:test'
import {
  confirmsTaskNotificationOnPlaybackStart,
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

test('confirms task notifications when client playback starts', () => {
  assert.equal(confirmsTaskNotificationOnPlaybackStart({
    origin: 'announcement',
  }), true)
  assert.equal(confirmsTaskNotificationOnPlaybackStart({
    origin: 'model',
    consumesTaskNotification: true,
  }), true)
  assert.equal(confirmsTaskNotificationOnPlaybackStart({
    origin: 'model',
  }), false)
})
