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
  })
  assert.equal(client.protocol, 'openclaw')
  assert.equal(client.describe().sessionModel, 'one-persistent-backend-agent')
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
