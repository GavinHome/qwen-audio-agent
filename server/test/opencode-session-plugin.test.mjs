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
  assert.match(result.delegation_id, /^[0-9a-f-]{36}$/)
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

test('session send returns a delegation id for Gateway correlation', async () => {
  const session = {
    id: 'ses_existing',
    title: '已有项目',
    directory: '/project',
    agent: 'build',
    metadata: {},
  }
  const client = {
    session: {
      async get() {
        return { data: session }
      },
      async update(options) {
        session.metadata = {
          ...session.metadata,
          ...options.body.metadata,
        }
        return { data: session }
      },
      async promptAsync() {
        return { data: undefined }
      },
    },
  }
  const plugin = await QwenAudioAgentSessionsPlugin({ client })
  const result = JSON.parse(
    await plugin.tool.qwen_audio_agent_session_send.execute({
      session_id: session.id,
      prompt: '继续完成任务',
      directory: '/project',
    }, context()),
  )

  assert.equal(result.status, 'started')
  assert.equal(result.session_id, session.id)
  assert.equal(result.delegation_id, session.metadata.qwen_audio_agent_run_id)
  assert.equal(session.metadata.qwen_audio_agent_delivery_pending, true)
})

test('session status returns a bounded latest assistant result', async () => {
  const client = {
    session: {
      async get() {
        return {
          data: {
            id: 'ses_existing',
            title: '已有项目',
            directory: '/project',
            time: { updated: 2 },
            metadata: {},
          },
        }
      },
      async status() {
        return { data: { ses_existing: { type: 'busy' } } }
      },
      async messages() {
        return {
          data: [{
            info: { role: 'assistant' },
            parts: [{ type: 'text', text: '结'.repeat(13_000) }],
          }],
        }
      },
    },
  }
  const plugin = await QwenAudioAgentSessionsPlugin({ client })
  const result = JSON.parse(
    await plugin.tool.qwen_audio_agent_session_status.execute({
      session_id: 'ses_existing',
      directory: '/project',
    }, context()),
  )

  assert.equal(result.state, 'busy')
  assert.equal(result.latest_result.length, 12_000)
})
