import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptsVoiceState,
  shouldAdvertiseVoice,
  shouldClaimReleasedVoice,
  visualVoiceState,
} from '../src/useRealtimeVoice.js'

test('ignores a stale direct-model state from an older voice turn', () => {
  assert.equal(acceptsVoiceState({
    type: 'voice.state',
    state: 'idle',
    turnId: 'voice-100-1',
    origin: 'model',
  }, 'voice-200-2'), false)
})

test('claims voice when another frontend releases a user-requested handoff', () => {
  assert.equal(shouldClaimReleasedVoice({
    type: 'voice.ownership',
    state: 'available',
  }, true), true)
  assert.equal(shouldClaimReleasedVoice({
    type: 'voice.ownership',
    state: 'busy',
  }, true), false)
  assert.equal(shouldClaimReleasedVoice({
    type: 'voice.ownership',
    state: 'available',
  }, false), false)
})

test('advertises voice only after microphone input is ready', () => {
  assert.equal(shouldAdvertiseVoice(true, false), false)
  assert.equal(shouldAdvertiseVoice(false, true), false)
  assert.equal(shouldAdvertiseVoice(true, true), true)
})

test('shows agent and announcement playback even when it belongs to an older turn', () => {
  assert.equal(acceptsVoiceState({
    type: 'voice.state',
    state: 'speaking',
    turnId: 'voice-100-1',
    origin: 'agent',
  }, 'voice-200-2'), true)
  assert.equal(acceptsVoiceState({
    type: 'voice.state',
    state: 'speaking',
    turnId: 'voice-100-1',
    origin: 'announcement',
  }, 'voice-200-2'), true)
})

test('shows local microphone activity immediately without changing model state', () => {
  assert.equal(visualVoiceState('idle', true, true), 'listening')
  assert.equal(visualVoiceState('thinking', true, true), 'listening')
  assert.equal(visualVoiceState('speaking', true, true), 'listening')
  assert.equal(visualVoiceState('thinking', false, true), 'thinking')
  assert.equal(visualVoiceState('idle', true, false), 'idle')
})
