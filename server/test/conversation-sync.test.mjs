import assert from 'node:assert/strict'
import test from 'node:test'
import { ConversationSync } from '../src/conversation/conversation-sync.mjs'

test('keeps recent voice context isolated by owner and voice session', () => {
  const sync = new ConversationSync()
  sync.record({
    ownerId: 'owner-one',
    sessionId: 'voice-one',
    id: 'user-one',
    role: 'user',
    content: '继续首页',
    source: 'voice-user',
  })
  sync.record({
    ownerId: 'owner-two',
    sessionId: 'voice-one',
    id: 'user-two',
    role: 'user',
    content: '其他人的内容',
    source: 'voice-user',
  })
  assert.deepEqual(
    sync.frontendContext({
      ownerId: 'owner-one',
      sessionId: 'voice-one',
    }).map(item => item.content),
    ['继续首页'],
  )
})

test('deduplicates the same message id and retains agent presentations', () => {
  const sync = new ConversationSync()
  const input = {
    ownerId: 'owner',
    sessionId: 'voice',
    id: 'same',
    role: 'assistant',
    content: '完成',
    source: 'agent-presentation',
    taskId: 'work-one',
  }
  sync.record(input)
  sync.record(input)
  assert.equal(sync.list({ ownerId: 'owner', sessionId: 'voice' }).length, 1)
  assert.equal(
    sync.frontendContext({ ownerId: 'owner', sessionId: 'voice' })[0].content,
    '完成',
  )
})
