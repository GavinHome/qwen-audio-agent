import assert from 'node:assert/strict'
import test from 'node:test'
import { TaskManager } from '../src/task/task-manager.mjs'
import { ToolCallHandler } from '../src/voice/tools/tool-call-handler.mjs'
import { TurnTranscripts } from '../src/voice/tools/turn-transcripts.mjs'

function harness({
  coordinator,
  manager = new TaskManager(),
  memoryStore = null,
  onMemoryChanged = () => {},
  coordinatorAvailable = async () => true,
} = {}) {
  const outputs = []
  const transcripts = new TurnTranscripts({ waitMs: 5 })
  const handler = new ToolCallHandler({
    taskManager: manager,
    ownerId: 'owner',
    sessionId: 'voice',
    transcripts,
    getFrontend: () => ({
      sendFunctionOutput: async (...args) => outputs.push(args),
    }),
    getTurnId: () => 'turn-one',
    getTurnGeneration: () => 1,
    coordinator: coordinator || {
      run: async () => ({ content: '完成', metadata: {} }),
    },
    coordinatorAvailable,
    memoryStore,
    onMemoryChanged,
    getConversationContext: () => [
      { role: 'user', content: '之前在改首页' },
    ],
  })
  return { outputs, manager, transcripts, handler }
}

test('submits one nonblocking coordinator work item with organized intent', async () => {
  let received
  const kit = harness({
    coordinator: {
      run: async input => {
        received = input
        return { content: '完成', metadata: {} }
      },
    },
  })
  kit.transcripts.record('turn-one', '继续改刚才那个页面')
  await kit.handler.handle({
    call_id: 'call-one',
    name: 'spawn_thinking',
    arguments: JSON.stringify({ objective: '继续修改此前讨论的页面' }),
  }, { turnId: 'turn-one', turnGeneration: 1 })

  assert.equal(kit.outputs[0][1].status, 'accepted')
  assert.deepEqual(kit.outputs[0][3], {
    response: {
      instructions: [
        '结合本轮调用工具前你已经对用户说过的内容，自主判断是否还需要回应。',
        '如果已经说明正在处理，不要重复或换一种说法再次确认。',
        '如果此前没有确认，可以用包含具体任务对象的短句确认；避免“好的、收到”等通用承接语。',
        'accepted 不代表已经完成。',
      ].join(' '),
    },
  })
  assert.equal(kit.manager.list({ ownerId: 'owner' }).length, 1)
  await kit.manager.wait(kit.outputs[0][1].work_id)
  assert.equal(received.originalRequest, '继续改刚才那个页面')
  assert.equal(received.objective, '继续修改此前讨论的页面')
  assert.equal(received.conversationContext[0].content, '之前在改首页')
})

test('deduplicates repeated tool calls from one realtime turn', async () => {
  const kit = harness()
  kit.transcripts.record('turn-one', '执行一次')
  await kit.handler.handle({
    call_id: 'call-one',
    name: 'spawn_thinking',
    arguments: '{"objective":"执行一次"}',
  })
  await kit.handler.handle({
    call_id: 'call-two',
    name: 'spawn_thinking',
    arguments: '{"objective":"再执行一次"}',
  })
  assert.equal(kit.manager.list({ ownerId: 'owner' }).length, 1)
  assert.equal(kit.outputs.at(-1)[1].status, 'duplicate')
  assert.deepEqual(kit.outputs.at(-1)[3], { createResponse: false })
})

test('rejects delegated work immediately when no backend Agent is connected', async () => {
  const kit = harness({
    coordinatorAvailable: async () => false,
  })
  kit.transcripts.record('turn-one', '帮我修改项目')
  await kit.handler.handle({
    call_id: 'call-offline',
    name: 'spawn_thinking',
    arguments: '{"objective":"修改项目"}',
  })

  assert.equal(kit.outputs[0][1].error_code, 'backend_unavailable')
  assert.equal(kit.outputs[0][1].retryable, true)
  assert.equal(kit.manager.list({ ownerId: 'owner' }).length, 0)
})

test('deduplicates the same turn after a realtime handler reconnect', async () => {
  const manager = new TaskManager()
  let runs = 0
  const coordinator = {
    run: async () => {
      runs += 1
      return { content: '完成', metadata: {} }
    },
  }
  const first = harness({ coordinator, manager })
  first.transcripts.record('turn-one', '执行一次')
  await first.handler.handle({
    call_id: 'call-before-reconnect',
    name: 'spawn_thinking',
    arguments: '{"objective":"执行一次"}',
  })

  const second = harness({ coordinator, manager })
  second.transcripts.record('turn-one', '执行一次')
  await second.handler.handle({
    call_id: 'call-after-reconnect',
    name: 'spawn_thinking',
    arguments: '{"objective":"执行一次"}',
  })
  await manager.wait(first.outputs[0][1].work_id)
  assert.equal(manager.list({ ownerId: 'owner' }).length, 1)
  assert.equal(second.outputs[0][1].status, 'duplicate')
  assert.equal(runs, 1)
})

test('cancels the most recently submitted active work', async () => {
  const kit = harness()
  let release
  kit.handler.coordinator = {
    run: async (_input, { signal }) => new Promise((resolve, reject) => {
      release = resolve
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      })
    }),
  }
  kit.transcripts.record('turn-one', '执行一次')
  await kit.handler.handle({
    call_id: 'call-one',
    name: 'spawn_thinking',
    arguments: '{"objective":"执行一次"}',
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(kit.manager.list({ active: true }).length, 1)
  await kit.handler.handle({
    call_id: 'call-two',
    name: 'cancel_agent_task',
    arguments: '{}',
  })
  assert.equal(kit.outputs.at(-1)[1].status, 'cancelled')
  assert.equal(kit.manager.list({ active: true }).length, 0)
  assert.equal(kit.manager.list()[0].status, 'cancelled')
  release?.()
})

test('uses one scoped memory tool for recall and remember', async () => {
  const calls = []
  let changes = 0
  const memoryStore = {
    list: (ownerId, options) => {
      calls.push(['list', ownerId, options])
      return [{
        id: 'profile_one',
        scope: 'profile',
        content: '用户希望被称为老大',
        editable: true,
      }]
    },
    remember: (ownerId, input) => {
      calls.push(['remember', ownerId, input])
      return { id: 'mem_one', ...input, editable: true }
    },
  }
  const kit = harness({
    memoryStore,
    onMemoryChanged: () => { changes += 1 },
  })

  await kit.handler.handle({
    call_id: 'memory-recall',
    name: 'user_memory',
    arguments: '{"action":"recall","scope":"all","query":"称呼"}',
  })
  assert.equal(kit.outputs.at(-1)[1].status, 'ok')
  assert.deepEqual(calls[0], ['list', 'owner', {
    scope: 'all',
    query: '称呼',
  }])

  await kit.handler.handle({
    call_id: 'memory-remember',
    name: 'user_memory',
    arguments: JSON.stringify({
      action: 'remember',
      scope: 'long_term',
      content: '用户喜欢苹果',
    }),
  })
  assert.equal(kit.outputs.at(-1)[1].status, 'remembered')
  assert.deepEqual(calls[1], ['remember', 'owner', {
    scope: 'long_term',
    content: '用户喜欢苹果',
  }])
  assert.equal(changes, 1)
})

test('replaces recalled text memories in one storage operation', async () => {
  let replaced
  let changes = 0
  const kit = harness({
    memoryStore: {
      replace: (ownerId, input) => {
        replaced = { ownerId, ...input }
        return {
          replaced: 2,
          memory: {
            id: 'mem_banana',
            scope: 'long_term',
            content: input.content,
            editable: true,
          },
        }
      },
    },
    onMemoryChanged: () => { changes += 1 },
  })

  await kit.handler.handle({
    call_id: 'memory-replace',
    name: 'user_memory',
    arguments: JSON.stringify({
      action: 'replace',
      scope: 'long_term',
      memory_ids: ['mem_apple', 'mem_likes_apple'],
      content: '用户最喜欢的水果是香蕉',
    }),
  })

  assert.deepEqual(replaced, {
    ownerId: 'owner',
    scope: 'long_term',
    ids: ['mem_apple', 'mem_likes_apple'],
    content: '用户最喜欢的水果是香蕉',
  })
  assert.equal(kit.outputs.at(-1)[1].status, 'replaced')
  assert.equal(kit.outputs.at(-1)[1].replaced, 2)
  assert.equal(changes, 1)
})

test('requires recalled ids for replacement and never guesses targets', async () => {
  const kit = harness({
    memoryStore: {
      replace: () => {
        throw new Error('must not run')
      },
    },
  })
  await kit.handler.handle({
    call_id: 'memory-replace-without-id',
    name: 'user_memory',
    arguments: JSON.stringify({
      action: 'replace',
      scope: 'long_term',
      content: '用户最喜欢的水果是香蕉',
    }),
  })
  assert.equal(kit.outputs.at(-1)[1].error_code, 'missing_memory_ids')
})

test('requires explicit user language before forgetting memory', async () => {
  let removed = 0
  const kit = harness({
    memoryStore: {
      forget: () => {
        removed += 1
        return 1
      },
    },
  })
  kit.transcripts.record('turn-one', '你还记得我的称呼吗')
  await kit.handler.handle({
    call_id: 'memory-forget-rejected',
    name: 'user_memory',
    arguments: '{"action":"forget","scope":"profile","query":"称呼"}',
  })
  assert.equal(kit.outputs.at(-1)[1].status, 'rejected')
  assert.equal(removed, 0)

  const allowed = harness({
    memoryStore: {
      forget: (_ownerId, options) => {
        assert.deepEqual(options, {
          scope: 'profile',
          query: '称呼',
          all: false,
        })
        return 1
      },
    },
  })
  allowed.transcripts.record('turn-one', '忘掉我的称呼')
  await allowed.handler.handle({
    call_id: 'memory-forget',
    name: 'user_memory',
    arguments: '{"action":"forget","scope":"profile","query":"称呼"}',
  })
  assert.equal(allowed.outputs.at(-1)[1].status, 'forgotten')
})

test('requires an explicit clear-all request before deleting an entire scope', async () => {
  let calls = 0
  const memoryStore = {
    forget: () => {
      calls += 1
      return 2
    },
  }
  const rejected = harness({ memoryStore })
  rejected.transcripts.record('turn-one', '忘掉我的称呼')
  await rejected.handler.handle({
    call_id: 'memory-clear-rejected',
    name: 'user_memory',
    arguments: '{"action":"forget","scope":"profile","all":true}',
  })
  assert.equal(rejected.outputs.at(-1)[1].error_code, 'clear_all_consent_required')
  assert.equal(calls, 0)

  const allowed = harness({ memoryStore })
  allowed.transcripts.record('turn-one', '清空全部长期记忆')
  await allowed.handler.handle({
    call_id: 'memory-clear',
    name: 'user_memory',
    arguments: '{"action":"forget","scope":"long_term","all":true}',
  })
  assert.equal(allowed.outputs.at(-1)[1].status, 'forgotten')
  assert.equal(calls, 1)
})

test('rejects secrets and an ambiguous memory scope', async () => {
  const kit = harness({
    memoryStore: {
      remember: () => {
        throw new Error('must not write')
      },
    },
  })
  await kit.handler.handle({
    call_id: 'memory-secret',
    name: 'user_memory',
    arguments: JSON.stringify({
      action: 'remember',
      scope: 'long_term',
      content: '我的 API Key 是 sk-secret',
    }),
  })
  assert.equal(kit.outputs.at(-1)[1].error_code, 'sensitive_memory')

  await kit.handler.handle({
    call_id: 'memory-all',
    name: 'user_memory',
    arguments: JSON.stringify({
      action: 'remember',
      scope: 'all',
      content: '用户喜欢苹果',
    }),
  })
  assert.equal(kit.outputs.at(-1)[1].error_code, 'missing_memory')
})
