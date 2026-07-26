import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { TaskManager } from '../src/task/task-manager.mjs'
import { TaskStore } from '../src/task/task-store.mjs'

test('persists final work and notification delivery state', async () => {
  const filePath = join(mkdtempSync(join(tmpdir(), 'qwen-audio-agent-')), 'tasks.json')
  const first = new TaskManager({ store: new TaskStore({ filePath }) })
  const work = first.create({
    objective: '保存结果',
    ownerId: 'owner',
    sessionId: 'voice',
    runner: async () => ({ content: '完成' }),
  })
  await first.wait(work.id)
  const claimed = first.claimNotifications({
    ownerId: 'owner',
    sessionId: 'voice',
    claimantId: 'client',
  })
  first.markNotificationsDelivered([claimed[0].id], { claimantId: 'client' })

  const restored = new TaskManager({ store: new TaskStore({ filePath }) })
  assert.equal(restored.get(work.id).result, '完成')
  assert.equal(restored.get(work.id).notificationStatus, 'delivered')
})

test('marks interrupted queued or running work as failed after restart', () => {
  const store = {
    load: () => [{
      id: 'work-one',
      status: 'running',
      objective: '未完成',
      ownerId: 'owner',
      sessionId: 'voice',
      createdAt: Date.now(),
      startedAt: Date.now(),
    }],
    save: () => {},
  }
  const manager = new TaskManager({ store })
  assert.equal(manager.get('work-one').status, 'failed')
  assert.match(manager.get('work-one').error, /重启/)
  assert.equal(manager.get('work-one').notificationStatus, 'pending')
})
