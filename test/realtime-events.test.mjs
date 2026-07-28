import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GATEWAY_CLIENT_EVENT_TYPES,
  GATEWAY_SERVER_EVENT_TYPES,
  GatewayClientEvent,
  GatewayServerEvent,
  GatewayTaskEvent,
} from '../shared/realtime-events.mjs'

test('keeps Gateway realtime event names unique within each direction', () => {
  assert.equal(
    GATEWAY_CLIENT_EVENT_TYPES.size,
    Object.keys(GatewayClientEvent).length,
  )
  assert.equal(
    GATEWAY_SERVER_EVENT_TYPES.size,
    Object.keys(GatewayServerEvent).length
      + Object.keys(GatewayTaskEvent).length,
  )
})

test('defines the shared playback acknowledgement lifecycle', () => {
  assert.deepEqual([
    GatewayServerEvent.AUDIO_DELTA,
    GatewayServerEvent.AUDIO_DONE,
    GatewayClientEvent.PLAYBACK_STARTED,
    GatewayClientEvent.PLAYBACK_ENDED,
    GatewayClientEvent.PLAYBACK_CANCELLED,
  ], [
    'audio.delta',
    'audio.done',
    'playback.started',
    'playback.ended',
    'playback.cancelled',
  ])
})
