import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import QwenAudioAgentSessionsPlugin from '../../config/opencode/plugin/qwen-audio-agent-sessions.js'

function context(overrides = {}) {
  return {
    agent: 'qwen-audio-agent-backend',
    sessionID: 'ses_coordinator',
    messageID: 'msg_coordinator',
    directory: '/workspace',
    worktree: '/workspace',
    abort: new AbortController().signal,
    metadata() {},
    ask: async () => {},
    ...overrides,
  }
}

test('backend Agent creates a normal top-level OpenCode session', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'qwen-audio-agent-session-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const taskPath = path.join(workspace, 'new-project')
  const calls = []
  const session = {
    id: 'ses_task',
    title: '独立项目',
    directory: taskPath,
    agent: 'build',
    time: { created: 1, updated: 1 },
    metadata: {
      qwen_audio_agent_managed: true,
      qwen_audio_agent_delivery_pending: false,
      qwen_audio_agent_backend_session_id: 'ses_coordinator',
      qwen_audio_agent_backend_directory: workspace,
    },
  }
  const client = {
    session: {
      async create(options) {
        calls.push(['create', options])
        return { data: session }
      },
      async update(options) {
        calls.push(['update', options])
        session.metadata = {
          ...session.metadata,
          ...options.body.metadata,
        }
        return { data: session }
      },
      async promptAsync(options) {
        calls.push(['promptAsync', options])
        return { data: undefined }
      },
    },
  }
  const plugin = await QwenAudioAgentSessionsPlugin({ client })
  const result = JSON.parse(await plugin.tool.qwen_audio_agent_session_start.execute({
    title: '独立项目',
    prompt: '完成新项目',
    directory: './new-project',
  }, context({ directory: workspace, worktree: workspace })))

  assert.equal(result.status, 'started')
  assert.equal(result.session_id, 'ses_task')
  const create = calls.find(([name]) => name === 'create')[1]
  assert.equal(create.query.directory, taskPath)
  assert.equal(create.body.parentID, undefined)
  assert.equal(create.body.agent, 'build')
  const prompt = calls.find(([name]) => name === 'promptAsync')[1]
  assert.equal(prompt.path.id, 'ses_task')
  assert.equal(prompt.body.agent, 'build')
  assert.equal(prompt.body.tools.qwen_audio_agent_session_start, false)
  assert.match(prompt.body.system, /Do not open browsers/)
})

test('OpenCode session tools reject other agents', async () => {
  const plugin = await QwenAudioAgentSessionsPlugin({ client: { session: {} } })
  await assert.rejects(
    plugin.tool.qwen_audio_agent_sessions_list.execute(
      {},
      context({ agent: 'build' }),
    ),
    /只允许 qwen-audio-agent 后台 Agent/,
  )
})

test('managed OpenCode completion is injected back into backend Agent', async () => {
  const calls = []
  const managed = {
    id: 'ses_task_done',
    title: '普通 Chat',
    directory: '/project',
    agent: 'build',
    metadata: {
      qwen_audio_agent_managed: true,
      qwen_audio_agent_delivery_pending: true,
      qwen_audio_agent_run_id: 'run_1',
      qwen_audio_agent_backend_session_id: 'ses_coordinator',
      qwen_audio_agent_backend_directory: '/workspace',
    },
    time: { created: 1, updated: 2 },
  }
  const client = {
    session: {
      async get() {
        return { data: managed }
      },
      async messages() {
        return {
          data: [{
            info: { id: 'msg_result', role: 'assistant' },
            parts: [{ type: 'text', text: '任务已经完成。' }],
          }],
        }
      },
      async update(options) {
        calls.push(['update', options])
        managed.metadata = {
          ...managed.metadata,
          ...options.body.metadata,
        }
        return { data: managed }
      },
      async promptAsync(options) {
        calls.push(['promptAsync', options])
        return { data: undefined }
      },
    },
  }
  const plugin = await QwenAudioAgentSessionsPlugin({ client })
  await plugin.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'ses_task_done' },
    },
  })

  assert.equal(managed.metadata.qwen_audio_agent_delivery_pending, false)
  const prompt = calls.find(([name]) => name === 'promptAsync')[1]
  assert.equal(prompt.path.id, 'ses_coordinator')
  assert.equal(prompt.query.directory, '/workspace')
  assert.equal(prompt.body.agent, 'qwen-audio-agent-backend')
  assert.match(prompt.body.parts[0].text, /任务已经完成/)
  assert.match(prompt.body.parts[0].text, /qwen_audio_agent_backend_session_event/)
})
