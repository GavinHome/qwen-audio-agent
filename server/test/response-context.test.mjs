import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureResponseContext,
  mergeResponseContext,
} from '../src/voice/response-context.mjs'

test('creates a complete fallback context for out-of-order transcript events', () => {
  const contexts = new Map()
  const context = ensureResponseContext(contexts, 'response-1', {
    turnId: 'turn-1',
  })

  context.pendingTranscripts.push({ content: '天气', final: false })

  assert.equal(context.turnId, 'turn-1')
  assert.deepEqual(context.pendingTranscripts, [
    { content: '天气', final: false },
  ])
  assert.equal(context.playbackStarted, false)
  assert.equal(context.transcriptDone, false)
})

test('response.created metadata preserves events received before it', () => {
  const contexts = new Map()
  const early = ensureResponseContext(contexts, 'response-1', {
    turnId: 'fallback-turn',
  })
  early.hasAudio = true
  early.playbackStarted = true
  early.transcriptDone = true
  early.pendingTranscripts.push({ content: '杭州天气', final: true })

  const merged = mergeResponseContext(contexts, 'response-1', {
    turnId: 'announcement-turn',
    taskId: 'job-weather',
    origin: 'announcement',
  })

  assert.equal(merged.turnId, 'announcement-turn')
  assert.equal(merged.taskId, 'job-weather')
  assert.equal(merged.origin, 'announcement')
  assert.equal(merged.hasAudio, true)
  assert.equal(merged.playbackStarted, true)
  assert.equal(merged.transcriptDone, true)
  assert.deepEqual(merged.pendingTranscripts, [
    { content: '杭州天气', final: true },
  ])
})

test('repairs legacy contexts without a pending transcript queue', () => {
  const contexts = new Map([
    ['response-1', { turnId: 'turn-1', origin: 'model' }],
  ])

  const context = ensureResponseContext(contexts, 'response-1')
  context.pendingTranscripts.push({ content: '可以继续', final: false })

  assert.equal(context.pendingTranscripts.length, 1)
})

test('preserves a cancelled response tombstone when metadata arrives late', () => {
  const contexts = new Map()
  const cancelled = ensureResponseContext(contexts, 'response-1', {
    turnId: 'turn-1',
    origin: 'announcement',
  })
  cancelled.suppressed = true
  cancelled.playbackEnded = true

  const merged = mergeResponseContext(contexts, 'response-1', {
    turnId: 'turn-1',
    origin: 'announcement',
    taskIds: ['work-1'],
  })

  assert.equal(merged.suppressed, true)
  assert.equal(merged.playbackEnded, true)
  assert.deepEqual(merged.taskIds, ['work-1'])
})
