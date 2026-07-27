import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentClient, agentSessionKey } from '../src/agent/agent-client.mjs'
import {
  openClawActivity,
  OpenClawAdapter,
} from '../src/agent/openclaw-adapter.mjs'
import { eventActivity, OpenCodeAdapter } from '../src/agent/opencode-adapter.mjs'
import { QoderAdapter } from '../src/agent/qoder-adapter.mjs'

test('Qoder full permission mode uses the SDK bypass flags', () => {
  const adapter = new QoderAdapter({
    permissionMode: 'full',
    sdk: {
      qodercliAuth: () => ({ type: 'qodercli' }),
    },
  })
  const options = adapter.queryOptions()
  assert.equal(options.permissionMode, 'bypassPermissions')
  assert.equal(options.allowDangerouslySkipPermissions, true)
  assert.equal(adapter.describe().permissionMode, 'full')
})

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

test('selects Qoder as a native persistent backend Agent', () => {
  const client = new AgentClient({
    protocol: 'qoder',
    qoderModel: 'auto',
    qoderDirectory: '/coordinator',
    qoderSdk: {
      accessTokenFromEnv: () => ({ type: 'token' }),
      qodercliAuth: () => ({ type: 'qodercli' }),
      listSessions: async () => [],
    },
  })
  assert.equal(client.protocol, 'qoder')
  assert.equal(client.describe().label, 'Qoder')
  assert.equal(client.describe().baseUrl, null)
  assert.equal(client.describe().capabilities.nativeSessionHistory, true)
})

test('Qoder coordinator resumes an existing native project session', async () => {
  const calls = []
  const events = []
  const sdk = {
    accessTokenFromEnv: () => ({ type: 'token' }),
    qodercliAuth: () => ({ type: 'qodercli' }),
    createSdkMcpServer: ({ tools }) => ({ tools }),
    tool: (name, description, inputSchema, handler) => ({
      name,
      description,
      inputSchema,
      handler,
    }),
    listSessions: async () => [{
      sessionId: 'coordinator-session',
      cwd: '/coordinator',
      tag: 'qwen-audio-agent:owner-one:backend',
      summary: 'Backend Agent',
    }],
    getSessionInfo: async sessionId => sessionId === 'project-session'
      ? {
          sessionId,
          cwd: '/projects/existing',
          summary: 'Existing project',
        }
      : undefined,
    renameSession: async () => {},
    tagSession: async () => {},
    query: ({ prompt, options }) => {
      const iterator = (async function* messages() {
        calls.push({ prompt, options })
        if (prompt === 'coordinate') {
          const server = options.mcpServers.qwen_audio_agent
          const send = server.tools.find(toolDefinition => (
            toolDefinition.name === 'qwen_audio_agent_session_send'
          ))
          const output = await send.handler({
            session_id: 'project-session',
            prompt: 'Continue the existing project naturally.',
          })
          assert.match(output.content[0].text, /"status":"started"/)
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'coordinator-session',
            cwd: '/coordinator',
          }
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: '{"state":"delegated"}',
            session_id: 'coordinator-session',
          }
          return
        }
        if (prompt === 'Continue the existing project naturally.') {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'project-session',
            cwd: '/projects/existing',
          }
          yield {
            type: 'assistant',
            session_id: 'project-session',
            message: {
              content: [{
                type: 'tool_use',
                id: 'tool-one',
                name: 'Read',
                input: { file_path: 'README.md' },
              }],
            },
          }
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'Project work completed.',
            session_id: 'project-session',
          }
          return
        }
        assert.match(prompt, /qwen_audio_agent_delegation_result/)
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'coordinator-session',
          cwd: '/coordinator',
        }
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: JSON.stringify({
            work_id: 'work-one',
            state: 'completed',
            mode: 'respond',
            presentation: {
              speech: 'Existing project completed.',
              inline: 'Project details.',
            },
          }),
          session_id: 'coordinator-session',
        }
      })()
      iterator.close = async () => {}
      return iterator
    },
  }
  const adapter = new QoderAdapter({
    sdk,
    directory: '/coordinator',
    timeoutMs: 1000,
  })

  const result = await adapter.runCoordinator('coordinate', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-one',
    onEvent: event => events.push(event),
  })

  assert.match(result.content, /Existing project completed/)
  assert.deepEqual(
    JSON.parse(result.content).presentation.inline,
    {
      title: 'Qoder 结果',
      format: 'markdown',
      content: 'Project details.',
    },
  )
  const projectCall = calls.find(call => (
    call.prompt === 'Continue the existing project naturally.'
  ))
  assert.equal(projectCall.options.cwd, '/projects/existing')
  assert.equal(projectCall.options.resume, 'project-session')
  assert.equal(calls.length, 3)
  assert.ok(events.some(event => event.type === 'backend.delegated'))
  assert.ok(events.some(event => (
    event.type === 'backend.delegation.completed'
  )))
  assert.ok(events.some(event => (
    event.type === 'backend.activity'
    && event.activity.tool === 'Read'
  )))
})

test('Qoder recovers when an interrupted new coordinator session already exists', async () => {
  const calls = []
  const renamed = []
  const tagged = []
  const sdk = {
    accessTokenFromEnv: () => ({ type: 'token' }),
    qodercliAuth: () => ({ type: 'qodercli' }),
    createSdkMcpServer: ({ tools }) => ({ tools }),
    tool: (name, description, inputSchema, handler) => ({
      name,
      description,
      inputSchema,
      handler,
    }),
    listSessions: async () => [],
    getSessionInfo: async sessionId => ({
      sessionId,
      cwd: '/coordinator',
      summary: 'Interrupted coordinator turn',
    }),
    renameSession: async (...args) => renamed.push(args),
    tagSession: async (...args) => tagged.push(args),
    query: ({ prompt, options }) => {
      calls.push({ prompt, options })
      const iterator = (async function* messages() {
        if (calls.length === 1) {
          throw new Error('Qoder CLI process exited with code 42')
        }
        yield {
          type: 'system',
          subtype: 'init',
          session_id: options.resume,
          cwd: '/coordinator',
        }
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '{"state":"completed"}',
          session_id: options.resume,
        }
      })()
      iterator.close = async () => {}
      return iterator
    },
  }
  const adapter = new QoderAdapter({
    sdk,
    directory: '/coordinator',
    timeoutMs: 1000,
  })

  const result = await adapter.runCoordinator('继续处理', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-recovery',
  })

  assert.equal(result.content, '{"state":"completed"}')
  assert.equal(calls.length, 2)
  assert.ok(calls[0].options.sessionId)
  assert.equal(calls[0].options.resume, undefined)
  assert.equal(calls[1].options.sessionId, undefined)
  assert.equal(calls[1].options.resume, calls[0].options.sessionId)
  assert.equal(renamed.length, 1)
  assert.equal(tagged.length, 1)
  assert.equal(tagged[0][1], 'qwen-audio-agent:owner-one:backend')
})

test('Qoder forwards its permission rules without inventing Gateway policy', async () => {
  const events = []
  const adapter = new QoderAdapter({
    sdk: {},
    directory: '/coordinator',
  })
  const permission = adapter.permissionCallback({
    ownerId: 'owner-one',
    coordinationRunId: 'work-one',
    onEvent: event => events.push(event),
  })
  const suggestions = [{
    type: 'addRules',
    behavior: 'allow',
    destination: 'session',
    rules: [{ toolName: 'Bash', ruleContent: 'git status:*' }],
  }]

  const first = permission(
    'Bash',
    { command: 'git status' },
    { toolUseID: 'tool-one', suggestions },
  )
  const requested = events.find(event => (
    event.type === 'backend.permission.requested'
  ))
  assert.ok(requested?.permission?.id)

  await adapter.respondPermission(
    requested.permission.id,
    'always',
    { ownerId: 'owner-one' },
  )
  const firstResult = await first
  assert.equal(firstResult.behavior, 'allow')
  assert.equal(firstResult.decisionClassification, 'user_permanent')
  assert.deepEqual(firstResult.updatedPermissions, suggestions)
  assert.deepEqual(requested.permission.patterns, ['git status:*'])

  const second = permission(
    'Bash',
    { command: 'git log -5' },
    { toolUseID: 'tool-two' },
  )
  assert.equal(events.filter(event => (
    event.type === 'backend.permission.requested'
  )).length, 2)
  const secondRequest = events.at(-1)
  await adapter.respondPermission(
    secondRequest.permission.id,
    'reject',
    { ownerId: 'owner-one' },
  )
  assert.equal((await second).behavior, 'deny')
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

test('asks an idle coordinator to cancel delegated work', async () => {
  const calls = []
  let targetBusy = true
  const adapter = new OpenCodeAdapter({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (path === '/session/ses-backend/message') {
        const body = JSON.parse(options.body)
        calls.push(body.parts[0].text)
        targetBusy = false
        return Response.json({
          info: { id: 'cancel-confirmation' },
          parts: [{ type: 'text', text: '已取消。' }],
        })
      }
      if (path === '/session/status') {
        return Response.json(targetBusy
          ? { 'ses-target': { type: 'busy' } }
          : {})
      }
      throw new Error(`unexpected request: ${url}`)
    },
    baseUrl: 'http://opencode.test',
    directory: '/workspace',
    coordinatorAgent: 'qwen-audio-agent-backend',
    timeoutMs: 1000,
  })
  const rejected = new Promise((resolve, reject) => {
    const delegation = {
      id: 'run-one',
      sessionId: 'ses-target',
      directory: '/project',
      settled: false,
      reject,
    }
    adapter.delegatedWorkRuns.set('work-one', {
      ownerId: 'owner-one',
      coordinationRunId: 'work-one',
      backendSessionId: 'ses-backend',
      backendAgent: 'qwen-audio-agent-backend',
      delegation,
    })
  }).catch(error => error)

  const result = await adapter.cancelDelegatedWork('work-one', {
    ownerId: 'owner-one',
  })

  assert.equal(result.route, 'coordinator')
  assert.match(calls[0], /qwen_audio_agent_session_cancel/)
  assert.match(calls[0], /ses-target/)
  assert.match((await rejected).message, /用户已取消/)
})

test('aborts delegated work directly when the coordinator is occupied', async () => {
  let directAborts = 0
  const adapter = new OpenCodeAdapter({
    fetchImpl: async (url) => {
      const path = new URL(url).pathname
      if (path === '/session/ses-target/abort') {
        directAborts += 1
        return Response.json(true)
      }
      throw new Error(`unexpected request: ${url}`)
    },
    baseUrl: 'http://opencode.test',
    directory: '/workspace',
    coordinatorAgent: 'qwen-audio-agent-backend',
    timeoutMs: 1000,
  })
  adapter.sessionQueues.set('ses-backend', new Promise(() => {}))
  const rejected = new Promise((resolve, reject) => {
    const delegation = {
      id: 'run-one',
      sessionId: 'ses-target',
      directory: '/project',
      settled: false,
      reject,
    }
    adapter.delegatedWorkRuns.set('work-one', {
      ownerId: 'owner-one',
      coordinationRunId: 'work-one',
      backendSessionId: 'ses-backend',
      backendAgent: 'qwen-audio-agent-backend',
      delegation,
    })
  }).catch(error => error)

  const result = await adapter.cancelDelegatedWork('work-one', {
    ownerId: 'owner-one',
  })

  assert.equal(result.route, 'adapter')
  assert.equal(directAborts, 1)
  assert.match((await rejected).message, /用户已取消/)
})

test('queues delegated status queries on the coordinator with exact target context', async () => {
  const prompts = []
  const adapter = new OpenCodeAdapter({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (path === '/session/ses-backend/message') {
        const body = JSON.parse(options.body)
        prompts.push(body.parts[0].text)
        return Response.json({
          info: { id: 'query-response' },
          parts: [{
            type: 'text',
            text: JSON.stringify({
              work_id: 'work-one',
              state: 'completed',
              mode: 'respond',
              presentation: {
                speech: '目前仍在检查模型目录。',
                inline: null,
              },
            }),
          }],
        })
      }
      throw new Error(`unexpected request: ${url}`)
    },
    baseUrl: 'http://opencode.test',
    directory: '/workspace',
    coordinatorAgent: 'qwen-audio-agent-backend',
    timeoutMs: 1000,
  })
  let releaseCoordinator
  adapter.sessionQueues.set('ses-backend', new Promise(resolve => {
    releaseCoordinator = resolve
  }))
  adapter.delegatedWorkRuns.set('work-one', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-one',
    backendSessionId: 'ses-backend',
    backendAgent: 'qwen-audio-agent-backend',
    delegation: {
      id: 'run-one',
      sessionId: 'ses-target',
      title: 'Megatron-LM',
      directory: '/project',
      settled: false,
      cancelling: false,
    },
  })

  const pending = adapter.queryDelegatedWork(
    'work-one',
    '已经查到了哪些模型？',
    { ownerId: 'owner-one' },
  )
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(prompts.length, 0)
  releaseCoordinator()
  const result = await pending

  assert.match(result.content, /目前仍在检查模型目录/)
  assert.match(prompts[0], /qwen_audio_agent_session_status/)
  assert.match(prompts[0], /ses-target/)
  assert.match(prompts[0], /\/project/)
  assert.match(prompts[0], /已经查到了哪些模型/)
})

test('reconciles one direct delegated cancellation on the next coordinator turn', async () => {
  const prompts = []
  const adapter = new OpenCodeAdapter({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname
      if (path === '/session/ses-target/abort') return Response.json(true)
      if (path === '/agent') {
        return Response.json([{
          name: 'qwen-audio-agent-backend',
          mode: 'primary',
        }])
      }
      if (path === '/session' && options.method === 'GET') {
        return Response.json([{
          id: 'ses-backend',
          metadata: {
            qwen_audio_agent_backend_key:
              'qwen-audio-agent:owner-one:backend',
            qwen_audio_agent_role: 'backend',
          },
        }])
      }
      if (path === '/session/ses-backend/message') {
        const body = JSON.parse(options.body)
        prompts.push(body.parts[0].text)
        return Response.json({
          info: { id: `response-${prompts.length}` },
          parts: [{ type: 'text', text: '已处理下一项任务。' }],
        })
      }
      throw new Error(`unexpected request: ${url}`)
    },
    baseUrl: 'http://opencode.test',
    directory: '/workspace',
    coordinatorAgent: 'qwen-audio-agent-backend',
    timeoutMs: 1000,
  })
  adapter.sessionQueues.set('ses-backend', new Promise(() => {}))
  const rejected = new Promise((resolve, reject) => {
    adapter.delegatedWorkRuns.set('work-one', {
      ownerId: 'owner-one',
      coordinationRunId: 'work-one',
      backendSessionId: 'ses-backend',
      backendAgent: 'qwen-audio-agent-backend',
      delegation: {
        id: 'run-one',
        sessionId: 'ses-target',
        directory: '/project',
        settled: false,
        reject,
      },
    })
  }).catch(error => error)

  const cancellation = await adapter.cancelDelegatedWork('work-one', {
    ownerId: 'owner-one',
  })
  assert.equal(cancellation.route, 'adapter')
  assert.match((await rejected).message, /用户已取消/)
  adapter.sessionQueues.delete('ses-backend')

  await adapter.runCoordinator('处理下一项任务', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-two',
  })
  await adapter.runCoordinator('再处理一项任务', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-three',
  })

  assert.match(prompts[0], /qwen_audio_agent_work_events/)
  assert.match(prompts[0], /delegation\.cancelled/)
  assert.match(prompts[0], /work-one/)
  assert.doesNotMatch(prompts[1], /qwen_audio_agent_work_events/)
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
