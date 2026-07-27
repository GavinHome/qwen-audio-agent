import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentClient, agentSessionKey } from '../src/agent/agent-client.mjs'
import {
  openClawActivity,
  OpenClawAdapter,
} from '../src/agent/openclaw-adapter.mjs'
import { eventActivity, OpenCodeAdapter } from '../src/agent/opencode-adapter.mjs'

test('selects OpenCode and describes the fixed backend Agent model', () => {
  const client = new AgentClient({
    protocol: 'opencode',
    fetchImpl: async () => new Response('{}'),
    baseUrl: 'http://opencode.test',
    directory: '/workspace',
    coordinatorAgent: 'qwen-audio-agent-backend',
  })
  assert.equal(client.protocol, 'opencode')
  assert.equal(client.describe().sessionModel, 'one-persistent-backend-agent')
  assert.equal(agentSessionKey('owner-one'), 'qwen-audio-agent:owner-one:backend')
})

test('opens the active OpenCode backend Agent session directly', async () => {
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname
    if (path === '/agent') {
      return Response.json([{ name: 'qwen-audio-agent-backend', mode: 'primary' }])
    }
    if (path === '/session' && options.method === 'GET') {
      return Response.json([
        {
          id: 'ses-current',
          title: 'qwen-audio-agent · Backend Agent',
          directory: '/workspace',
          metadata: {
            qwen_audio_agent_backend_key: 'qwen-audio-agent:owner-one:backend',
            qwen_audio_agent_role: 'backend',
          },
          time: { updated: 20 },
        },
      ])
    }
    throw new Error(`unexpected request: ${url}`)
  }
  const client = new AgentClient({
    protocol: 'opencode',
    fetchImpl,
    baseUrl: 'http://opencode.test:4096',
    directory: '/workspace',
  })

  assert.equal(
    await client.uiUrl({ ownerId: 'owner-one' }),
    'http://opencode.test:4096/server/aHR0cDovL29wZW5jb2RlLnRlc3Q6NDA5Ng/session/ses-current',
  )
})

test('selects OpenClaw without changing the backend Agent session model', () => {
  const client = new AgentClient({
    protocol: 'openclaw',
    openClawBaseUrl: 'http://openclaw.test:18789',
    openClawCoordinatorAgent: 'qwen-audio-agent-backend',
    model: 'bailian/qwen-custom',
  })
  assert.equal(client.protocol, 'openclaw')
  assert.equal(client.describe().sessionModel, 'one-persistent-backend-agent')
  assert.equal(client.describe().model, 'bailian/qwen-custom')
})

test('reuses one backend Agent session and serializes all submitted work', async () => {
  const calls = []
  let active = 0
  let maxActive = 0
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname
    if (path === '/agent') {
      return Response.json([{ name: 'qwen-audio-agent-backend', mode: 'primary' }])
    }
    if (path === '/session' && options.method === 'GET') {
      return Response.json([])
    }
    if (path === '/session') {
      calls.push(JSON.parse(options.body))
      return Response.json({ id: 'ses-fixed', metadata: calls[0].metadata })
    }
    if (path.endsWith('/message')) {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      return Response.json({
        info: { id: `reply-${calls.length}` },
        parts: [{ type: 'text', text: '{"state":"completed"}' }],
      })
    }
    throw new Error(`unexpected request: ${url}`)
  }
  const adapter = new OpenCodeAdapter({
    fetchImpl,
    baseUrl: 'http://opencode.test',
    directory: '/workspace',
    coordinatorAgent: 'qwen-audio-agent-backend',
    timeoutMs: 1000,
  })
  adapter.events.subscribe = () => () => {}

  await Promise.all([
    adapter.runCoordinator('A', { ownerId: 'owner-one' }),
    adapter.runCoordinator('B', { ownerId: 'owner-one' }),
  ])

  assert.equal(calls.length, 1)
  assert.equal(maxActive, 1)
  assert.equal(calls[0].title, 'qwen-audio-agent · Backend Agent')
})

test('aborts the active OpenCode backend run when its qwen-audio-agent work is cancelled', async () => {
  let abortCalls = 0
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname
    if (path === '/agent') {
      return Response.json([{ name: 'qwen-audio-agent-backend', mode: 'primary' }])
    }
    if (path === '/session' && options.method === 'GET') {
      return Response.json([{
        id: 'ses-current',
        title: 'qwen-audio-agent · Backend Agent',
        metadata: {
          qwen_audio_agent_backend_key: 'qwen-audio-agent:owner-one:backend',
          qwen_audio_agent_role: 'backend',
        },
      }])
    }
    if (path.endsWith('/abort')) {
      abortCalls += 1
      return Response.json(true)
    }
    if (path.endsWith('/message')) {
      return new Promise((resolve, reject) => {
        const fail = () => reject(options.signal.reason)
        if (options.signal.aborted) fail()
        else options.signal.addEventListener('abort', fail, { once: true })
      })
    }
    throw new Error(`unexpected request: ${url}`)
  }
  const adapter = new OpenCodeAdapter({
    fetchImpl,
    baseUrl: 'http://opencode.test',
    directory: '/workspace',
    timeoutMs: 1000,
  })
  adapter.events.subscribe = () => () => {}
  adapter.events.ready = async () => {}
  const controller = new AbortController()
  const running = adapter.runCoordinator('执行长任务', {
    ownerId: 'owner-one',
    signal: controller.signal,
  })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort(new Error('用户取消'))

  await assert.rejects(running, /用户取消/)
  assert.equal(abortCalls, 1)
})

test('routes a child OpenCode permission to its voice work and replies always', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/session/ses-child') {
      return Response.json({
        id: 'ses-child',
        metadata: {
          qwen_audio_agent_backend_session_id: 'ses-backend',
        },
      })
    }
    if (parsed.pathname === '/permission/per-one/reply') {
      calls.push({
        path: parsed.pathname,
        body: JSON.parse(options.body),
      })
      return Response.json(true)
    }
    throw new Error(`unexpected request: ${url}`)
  }
  const adapter = new OpenCodeAdapter({
    fetchImpl,
    baseUrl: 'http://opencode.test',
    directory: '/workspace',
    timeoutMs: 1000,
  })
  const events = []
  adapter.activeRuns.set('ses-backend', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-one',
    onEvent: event => events.push(event),
  })
  adapter.handlePermissionAsked({
    type: 'permission.asked',
    sessionId: 'ses-child',
    directory: '/project',
    payload: {
      properties: {
        id: 'per-one',
        sessionID: 'ses-child',
        permission: 'bash',
        patterns: ['npm test'],
        metadata: {},
      },
    },
  })
  await new Promise(resolve => setImmediate(resolve))

  const requested = events.find(event => (
    event.type === 'backend.permission.requested'
  ))
  assert.equal(requested.permission.workId, 'work-one')
  assert.match(requested.permission.summary, /npm test/)

  const result = await adapter.respondPermission(
    requested.permission.id,
    'always',
    { ownerId: 'owner-one' },
  )
  assert.equal(result.status, 'approved')
  assert.deepEqual(calls, [{
    path: '/permission/per-one/reply',
    body: { reply: 'always' },
  }])
  assert.equal(
    events.at(-1).type,
    'backend.permission.resolved',
  )
})

test('keeps voice work delegated until the matching OpenCode session is idle', async () => {
  const observers = new Set()
  const emitBackendEvent = event => {
    for (const observer of observers) observer(event)
  }
  let backendMessages = 0
  let aborts = 0
  let deliveryConfirmed = false
  let targetBusy = true
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    const path = parsed.pathname
    if (path === '/agent') {
      return Response.json([{
        name: 'qwen-audio-agent-backend',
        mode: 'primary',
      }])
    }
    if (path === '/session' && options.method === 'GET') {
      return Response.json([{
        id: 'ses-backend',
        title: 'qwen-audio-agent · Backend Agent',
        metadata: {
          qwen_audio_agent_backend_key:
            'qwen-audio-agent:owner-one:backend',
          qwen_audio_agent_role: 'backend',
        },
      }])
    }
    if (path === '/session/ses-backend/abort') {
      aborts += 1
      return Response.json(true)
    }
    if (path === '/session/ses-backend/message') {
      backendMessages += 1
      const body = JSON.parse(options.body)
      const prompt = body.parts[0].text
      if (prompt === '继续已有项目') {
        queueMicrotask(() => {
          emitBackendEvent({
            type: 'message.part.updated',
            sessionId: 'ses-unrelated',
            directory: '/other',
            payload: {
              properties: {
                part: {
                  type: 'tool',
                  tool: 'qwen_audio_agent_session_send',
                  state: {
                    status: 'completed',
                    output: JSON.stringify({
                      status: 'started',
                      delegation_id: 'run-unrelated',
                      session_id: 'ses-unrelated-target',
                    }),
                  },
                },
              },
            },
          })
          emitBackendEvent({
            type: 'message.part.updated',
            sessionId: 'ses-backend',
            directory: '/workspace',
            payload: {
              properties: {
                part: {
                  type: 'tool',
                  tool: 'qwen_audio_agent_session_send',
                  state: {
                    status: 'completed',
                    output: JSON.stringify({
                      status: 'started',
                      delegation_id: 'run-one',
                      session_id: 'ses-target',
                      title: '已有项目',
                      directory: '/project',
                    }),
                  },
                },
              },
            },
          })
        })
        await new Promise(resolve => setTimeout(resolve, 5))
        return Response.json({
          info: { id: 'delegated-confirmation' },
          parts: [{
            type: 'text',
            text: JSON.stringify({
              work_id: 'work-one',
              state: 'delegated',
              mode: 'delegate',
              delegation_id: 'run-one',
              target_session_id: 'ses-target',
              presentation: {
                speech: '项目已经接着做了，我会先检查现状再完成修改。',
                inline: null,
              },
            }),
          }],
        })
      }
      if (prompt === '查询任务状态') {
        return Response.json({
          info: { id: 'status-response' },
          parts: [{ type: 'text', text: '第三层任务仍在执行。' }],
        })
      }
      assert.match(prompt, /目标项目已经完成/)
      return Response.json({
        info: { id: 'final-presentation' },
        parts: [{
          type: 'text',
          text: JSON.stringify({
            work_id: 'work-one',
            state: 'completed',
            mode: 'respond',
            presentation: {
              speech: '目标项目已经完成。',
              inline: null,
            },
          }),
        }],
      })
    }
    if (path === '/session/status') {
      return Response.json(targetBusy
        ? { 'ses-target': { type: 'busy' } }
        : {})
    }
    if (path === '/session/ses-target' && options.method === 'GET') {
      return Response.json({
        id: 'ses-target',
        title: '已有项目',
        directory: '/project',
        metadata: {
          qwen_audio_agent_run_id: 'run-one',
          qwen_audio_agent_run_started_at: 100,
          qwen_audio_agent_delivery_pending: true,
        },
      })
    }
    if (path === '/session/ses-target/message') {
      return Response.json([{
        info: {
          id: 'target-result',
          role: 'assistant',
          time: { created: 200 },
        },
        parts: [{ type: 'text', text: '目标项目已经完成。' }],
      }])
    }
    if (path === '/session/ses-target' && options.method === 'PATCH') {
      deliveryConfirmed = JSON.parse(options.body)
        .metadata.qwen_audio_agent_delivery_pending === false
      return Response.json({ id: 'ses-target' })
    }
    throw new Error(`unexpected request: ${url}`)
  }
  const adapter = new OpenCodeAdapter({
    fetchImpl,
    baseUrl: 'http://opencode.test',
    directory: '/workspace',
    coordinatorAgent: 'qwen-audio-agent-backend',
    timeoutMs: 30,
  })
  adapter.events.subscribe = ({ onEvent }) => {
    observers.add(onEvent)
    return () => observers.delete(onEvent)
  }
  adapter.events.ready = async () => {}
  const events = []
  let settled = false
  const running = adapter.runCoordinator('继续已有项目', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-one',
    onEvent: event => events.push(event),
  }).finally(() => {
    settled = true
  })
  while (!events.some(event => event.type === 'backend.delegated')) {
    await new Promise(resolve => setImmediate(resolve))
  }
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(settled, false)
  assert.equal(backendMessages, 1)
  assert.equal(
    events.find(event => event.type === 'backend.delegated')
      .delegation.presentation.speech,
    '项目已经接着做了，我会先检查现状再完成修改。',
  )

  const statusResult = await adapter.runCoordinator('查询任务状态', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-status',
  })
  assert.equal(statusResult.content, '第三层任务仍在执行。')
  assert.equal(settled, false)
  assert.equal(backendMessages, 2)

  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(settled, false)

  targetBusy = false
  emitBackendEvent({
    type: 'session.idle',
    sessionId: 'ses-target',
    directory: '/project',
    payload: {
      properties: { sessionID: 'ses-target' },
    },
  })
  const result = await running

  assert.equal(result.content.includes('目标项目已经完成'), true)
  assert.equal(aborts, 0)
  assert.equal(backendMessages, 3)
  assert.equal(deliveryConfirmed, true)
  assert.ok(events.some(event => (
    event.type === 'backend.delegation.completed'
  )))
})

test('compatible OpenCode selects the existing default Agent and injects system instructions', async () => {
  let sent
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname
    if (path === '/agent') {
      return Response.json([{ name: 'build', mode: 'primary', native: true }])
    }
    if (path === '/session' && options.method === 'GET') return Response.json([])
    if (path === '/session') {
      const body = JSON.parse(options.body)
      assert.equal(body.agent, 'build')
      return Response.json({ id: 'ses-compatible', metadata: body.metadata })
    }
    if (path.endsWith('/message')) {
      sent = JSON.parse(options.body)
      return Response.json({
        info: { id: 'reply-compatible' },
        parts: [{ type: 'text', text: '{"state":"completed"}' }],
      })
    }
    throw new Error(`unexpected request: ${url}`)
  }
  const adapter = new OpenCodeAdapter({
    fetchImpl,
    baseUrl: 'http://opencode.test',
    directory: '/workspace',
    mode: 'compatible',
    timeoutMs: 1000,
  })
  adapter.events.subscribe = () => () => {}
  adapter.events.ready = async () => {}

  await adapter.runCoordinator('执行任务', { ownerId: 'owner-one' })

  assert.equal(sent.agent, 'build')
  assert.match(sent.system, /backend Agent for qwen-audio-agent/)
})

test('compatible OpenClaw selects its default Agent and injects instructions into the message', async () => {
  const adapter = new OpenClawAdapter({
    baseUrl: 'http://openclaw.test',
    mode: 'compatible',
    timeoutMs: 1000,
  })
  let sent
  adapter.gateway.listAgents = async () => ({
    defaultId: 'main',
    agents: [{ id: 'main', name: 'Main' }],
  })
  adapter.gateway.sendAndWait = async (key, message) => {
    sent = { key, message }
    return { content: '完成', runId: 'run-one' }
  }

  await adapter.runCoordinator('执行任务', { ownerId: 'owner-one' })

  assert.match(sent.key, /^agent:main:/)
  assert.match(sent.message, /qwen_audio_agent_backend_instructions/)
  assert.match(sent.message, /执行任务/)
})

test('projects OpenCode tool events into generic UI activity', () => {
  assert.deepEqual(eventActivity({
    type: 'message.part.updated',
    payload: {
      part: {
        id: 'tool-1',
        type: 'tool',
        tool: 'web_search',
        state: { status: 'running', input: { query: 'weather' } },
      },
    },
  }), {
    id: 'tool-1',
    kind: 'tool',
    tool: 'web_search',
    status: 'running',
    category: 'search',
    detail: 'weather',
  })
  const image = eventActivity({
    type: 'message.part.updated',
    payload: {
      part: {
        id: 'tool-2',
        type: 'tool',
        tool: 'bash',
        state: {
          status: 'running',
          input: { command: 'bl image generate --prompt hidden' },
        },
      },
    },
  })
  assert.equal(image.category, 'image')
  assert.equal(image.detail, '')
})

test('projects OpenClaw tool events into the same generic UI activity', () => {
  assert.deepEqual(openClawActivity({
    runId: 'run-1',
    stream: 'tool',
    data: {
      phase: 'start',
      toolCallId: 'tool-1',
      name: 'web_search',
      args: { query: 'weather' },
    },
  }), {
    id: 'tool-1',
    kind: 'tool',
    tool: 'web_search',
    status: 'running',
    category: 'search',
    detail: '',
  })
})
