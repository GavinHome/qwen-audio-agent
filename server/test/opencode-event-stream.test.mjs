import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeOpenCodeEvent,
  OpenCodeEventStream,
  sseJsonEvents,
} from '../src/agent/opencode-event-stream.mjs'

test('parses fragmented OpenCode SSE frames and preserves the workspace envelope', async () => {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        'data: {"directory":"/workspace","payload":{"type":"message.part.',
      ))
      controller.enqueue(encoder.encode(
        'updated","properties":{"sessionID":"ses_one","part":{"type":"tool"}}}}\n\n',
      ))
      controller.enqueue(encoder.encode(
        'data: {"payload":{"type":"session.idle","properties":{"sessionID":"ses_one"}}}\n\n',
      ))
      controller.close()
    },
  })

  const events = []
  for await (const event of sseJsonEvents(body)) events.push(event)
  assert.equal(events.length, 2)
  assert.deepEqual(normalizeOpenCodeEvent(events[0]), {
    type: 'message.part.updated',
    directory: '/workspace',
    project: null,
    sessionId: 'ses_one',
    payload: events[0].payload,
    raw: events[0],
  })
  assert.equal(normalizeOpenCodeEvent(events[1]).type, 'session.idle')
})

test('ignores malformed SSE data without losing the following event', async () => {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        'data: not-json\n\ndata: {"type":"session.idle","sessionID":"ses_two"}\n\n',
      ))
      controller.close()
    },
  })

  const events = []
  for await (const event of sseJsonEvents(body)) events.push(event)
  assert.equal(events.length, 1)
  assert.equal(normalizeOpenCodeEvent(events[0]).sessionId, 'ses_two')
})

test('delivers every session event to a wildcard subscriber', () => {
  const stream = new OpenCodeEventStream({
    fetchImpl: async () => {
      throw new Error('network should not be used by this test')
    },
    baseUrl: 'http://127.0.0.1:4096',
    headers: () => ({}),
  })
  stream.start = () => {}
  const received = []
  const unsubscribe = stream.subscribe({
    onEvent: event => received.push(event.sessionId),
  })

  stream.dispatch({
    payload: {
      type: 'session.idle',
      properties: { sessionID: 'ses_one' },
    },
  })
  stream.dispatch({
    payload: {
      type: 'session.idle',
      properties: { sessionID: 'ses_two' },
    },
  })

  unsubscribe()
  assert.deepEqual(received, ['ses_one', 'ses_two'])
})
