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

test('reattaches a persisted delegated run when its adapter supports recovery', async () => {
  let saved = [{
    id: 'work-delegated',
    status: 'delegated',
    objective: '继续项目',
    ownerId: 'owner',
    sessionId: 'voice',
    createdAt: Date.now(),
    startedAt: Date.now(),
    delegation: {
      id: 'run-one',
      sessionId: 'agent:child:one',
      directory: '/project',
      title: '项目任务',
    },
  }]
  const manager = new TaskManager({
    store: {
      load: () => structuredClone(saved),
      save: tasks => {
        saved = structuredClone(tasks)
      },
    },
  })

  manager.recoverDelegated({
    canRecover: task => task.delegation.id === 'run-one',
    runner: async (task, { onEvent }) => {
      onEvent({
        type: 'backend.delegated',
        delegation: task.delegation,
      })
      onEvent({
        type: 'backend.delegation.completed',
        delegation: task.delegation,
      })
      return { content: '恢复后的结果' }
    },
  })

  const result = await manager.wait('work-delegated')
  assert.equal(result.status, 'completed')
  assert.equal(result.result, '恢复后的结果')
  assert.equal(saved[0].delegation.id, 'run-one')
  assert.equal(saved[0].delegation.sessionId, 'agent:child:one')
})
