import { randomBytes } from 'node:crypto'
import { AgentError, BackendAdapter, requestSignal } from './backend-adapter.mjs'
import { BACKEND_AGENT_INSTRUCTIONS } from './backend-agent-instructions.mjs'
import { nestedValue, OpenCodeEventStream } from './opencode-event-stream.mjs'

const MANAGED_AGENT = 'qwen-audio-agent-backend'
const MANAGED_SESSION_TOOLS = [
  'qwen_audio_agent_sessions_list',
  'qwen_audio_agent_session_start',
  'qwen_audio_agent_session_send',
  'qwen_audio_agent_session_status',
  'qwen_audio_agent_session_cancel',
]

function agentSessionKey(ownerId, role) {
  return `qwen-audio-agent:${encodeURIComponent(String(ownerId || 'personal'))}:${role}`
}

function modelRef(value) {
  const [providerID, ...parts] = String(value || '').split('/')
  const modelID = parts.join('/')
  return providerID && modelID ? { providerID, modelID } : null
}

function responseText(payload) {
  if (payload?.info?.structured !== undefined) {
    return JSON.stringify(payload.info.structured)
  }
  return (payload?.parts || [])
    .filter(part => part?.type === 'text')
    .map(part => part.text || '')
    .join('\n')
    .trim()
}

function responseFailure(payload) {
  const error = payload?.info?.error
  if (!error) return null
  return error.data?.message || error.message || error.name || 'OpenCode 执行失败'
}

export function eventActivity(event) {
  if (event?.type === 'message.part.updated') {
    const part = nestedValue(event.payload || {}, ['part'])
    if (!part || typeof part !== 'object') return null
    if (part.type === 'tool') {
      const state = part.state || {}
      const input = state.input || {}
      const hint = `${part.tool || ''} ${input.command || ''} ${
        input.description || input.query || input.filePath || input.pattern || ''
      }`.toLowerCase()
      const detail = String(
        input.description
        || input.query
        || input.filePath
        || input.pattern
        || state.title
        || '',
      )
      return {
        id: part.id || null,
        kind: 'tool',
        tool: part.tool || 'tool',
        status: state.status || 'running',
        category: /image|imagegen|图片|图像|绘图/.test(hint)
          ? 'image'
          : /search|web|fetch|搜索|查询/.test(hint)
            ? 'search'
            : /read|glob|grep|list|读取|查找/.test(hint)
              ? 'read'
              : /write|edit|patch|写入|修改/.test(hint)
                ? 'write'
                : 'run',
        detail: detail.slice(0, 300),
      }
    }
    if (part.type === 'text' || part.type === 'reasoning') {
      return {
        id: part.id || null,
        kind: part.type,
        status: 'running',
      }
    }
  }
  return null
}

let lastTimestamp = 0
let counter = 0

function messageId() {
  const timestamp = Date.now()
  counter = timestamp === lastTimestamp ? counter + 1 : 1
  lastTimestamp = timestamp
  const time = (BigInt(timestamp) * 0x1000n + BigInt(counter))
    .toString(16)
    .padStart(12, '0')
    .slice(-12)
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const suffix = [...randomBytes(14)]
    .map(byte => alphabet[byte % alphabet.length])
    .join('')
  return `msg_${time}${suffix}`
}

export class OpenCodeAdapter extends BackendAdapter {
  protocol = 'opencode'

  constructor(options) {
    super(options)
    this.directory = options.directory
    this.username = options.username || 'opencode'
    this.password = options.password || ''
    this.mode = options.mode === 'compatible' ? 'compatible' : 'managed'
    this.backendAgent = String(options.coordinatorAgent || '').trim()
      || (this.mode === 'managed' ? MANAGED_AGENT : '')
    this.resolvedAgent = null
    this.sessionCache = new Map()
    this.sessionPromises = new Map()
    this.sessionQueues = new Map()
    this.events = new OpenCodeEventStream({
      fetchImpl: this.fetch,
      baseUrl: this.baseUrl,
      headers: () => this.headers(),
    })
  }

  get label() {
    return 'OpenCode'
  }

  headers() {
    return {
      ...(this.password
        ? {
            Authorization: `Basic ${Buffer.from(
              `${this.username}:${this.password}`,
            ).toString('base64')}`,
          }
        : {}),
      ...(this.directory
        ? { 'x-opencode-directory': encodeURIComponent(this.directory) }
        : {}),
    }
  }

  describe() {
    return {
      kind: this.protocol,
      label: this.label,
      baseUrl: this.baseUrl,
      uiPath: '/api/backend/ui',
      model: this.model || null,
      directory: this.directory,
      mode: this.mode,
      backendAgent: this.resolvedAgent || this.backendAgent || null,
      sessionModel: 'one-persistent-backend-agent',
    }
  }

  async uiUrl(ownerId) {
    const session = await this.ensureSession(ownerId)
    const serverKey = Buffer.from(this.baseUrl).toString('base64url')
    return `${
      this.baseUrl
    }/server/${serverKey}/session/${encodeURIComponent(session.id)}`
  }

  async health() {
    const response = await this.request('/global/health', {
      method: 'GET',
      headers: this.headers(),
      timeoutMs: 5000,
    })
    const payload = await response.json()
    const backendAgent = await this.resolveBackendAgent()
    let enhanced = false
    if (this.mode === 'managed') {
      const toolsResponse = await this.request('/experimental/tool/ids', {
        method: 'GET',
        headers: this.headers(),
        timeoutMs: 5000,
      })
      const tools = await toolsResponse.json()
      const missing = MANAGED_SESSION_TOOLS.filter(name => !tools.includes(name))
      if (missing.length) {
        throw new AgentError(
          `OpenCode 未加载 qwen-audio-agent Session 插件：${missing.join(', ')}`,
          { protocol: this.protocol },
        )
      }
      enhanced = true
    }
    return {
      ok: payload.healthy === true,
      status: response.status,
      version: payload.version,
      protocol: this.protocol,
      mode: this.mode,
      backendAgent,
      enhanced,
    }
  }

  async listAgents() {
    const response = await this.request('/agent', {
      method: 'GET',
      headers: this.headers(),
      timeoutMs: 5000,
    })
    return response.json()
  }

  async resolveBackendAgent() {
    if (this.resolvedAgent) return this.resolvedAgent
    const agents = await this.listAgents()
    const available = agents.filter(agent => !agent?.hidden)
    let selected
    if (this.backendAgent) {
      selected = available.find(agent => agent?.name === this.backendAgent)
      if (!selected) {
        throw new AgentError(
          `OpenCode 中不存在后台 Agent "${this.backendAgent}"`,
          { protocol: this.protocol },
        )
      }
    } else {
      selected = (
        available.find(agent => agent?.name === 'build')
        || available.find(agent => agent?.mode === 'primary')
        || available[0]
      )
    }
    if (!selected?.name) {
      throw new AgentError('OpenCode 没有可用的后台 Agent', {
        protocol: this.protocol,
      })
    }
    this.resolvedAgent = selected.name
    return this.resolvedAgent
  }

  async listSessions() {
    const query = new URLSearchParams({ limit: '100' })
    if (this.directory) query.set('directory', this.directory)
    const response = await this.request(`/session?${query}`, {
      method: 'GET',
      headers: this.headers(),
    })
    return response.json()
  }

  async createSession(key, ownerId, backendAgent) {
    const response = await this.request('/session', {
      headers: this.headers(),
      body: {
        title: 'qwen-audio-agent · Backend Agent',
        agent: backendAgent,
        metadata: {
          qwen_audio_agent_backend_key: key,
          qwen_audio_agent_role: 'backend',
          qwen_audio_agent_owner_id: String(ownerId || ''),
        },
      },
    })
    return response.json()
  }

  async normalizeBackendSession(session) {
    if (!session?.title || session.title === 'qwen-audio-agent · Backend Agent') {
      return session
    }
    const response = await this.request(
      `/session/${encodeURIComponent(session.id)}`,
      {
        method: 'PATCH',
        headers: this.headers(),
        body: { title: 'qwen-audio-agent · Backend Agent' },
      },
    )
    return response.json()
  }

  ensureSession(ownerId) {
    const key = agentSessionKey(ownerId, 'backend')
    if (this.sessionCache.has(key)) {
      return Promise.resolve(this.sessionCache.get(key))
    }
    if (this.sessionPromises.has(key)) return this.sessionPromises.get(key)
    const pending = this.resolveBackendAgent()
      .then(async backendAgent => ({
        backendAgent,
        sessions: await this.listSessions(),
      }))
      .then(({ backendAgent, sessions }) => (
        sessions
          .filter(session => (
            session?.metadata?.qwen_audio_agent_backend_key === key
            && session?.metadata?.qwen_audio_agent_role === 'backend'
          ))
          .sort((left, right) => (
            Number(right.time?.updated || right.time?.created || 0)
            - Number(left.time?.updated || left.time?.created || 0)
          ))[0]
        || this.createSession(key, ownerId, backendAgent)
      ))
      .then(session => this.normalizeBackendSession(session))
      .then(session => {
        if (!session?.id) {
          throw new AgentError('OpenCode 没有返回有效的后台 Agent Session', {
            protocol: this.protocol,
          })
        }
        this.sessionCache.set(key, session)
        return session
      })
      .finally(() => this.sessionPromises.delete(key))
    this.sessionPromises.set(key, pending)
    return pending
  }

  serialize(sessionId, operation) {
    const previous = this.sessionQueues.get(sessionId) || Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    this.sessionQueues.set(sessionId, current)
    current.finally(() => {
      if (this.sessionQueues.get(sessionId) === current) {
        this.sessionQueues.delete(sessionId)
      }
    }).catch(() => {})
    return current
  }

  async runCoordinator(message, {
    ownerId,
    signal,
    onEvent,
  } = {}) {
    const [session, backendAgent] = await Promise.all([
      this.ensureSession(ownerId),
      this.resolveBackendAgent(),
    ])
    return this.serialize(session.id, async () => {
      const combinedSignal = requestSignal(signal, this.timeoutMs)
      const runId = messageId()
      let abortPromise = null
      const abortBackend = () => {
        abortPromise ||= this.request(
          `/session/${encodeURIComponent(session.id)}/abort`,
          {
            headers: this.headers(),
            timeoutMs: 5000,
          },
        ).catch(() => null)
      }
      combinedSignal?.addEventListener('abort', abortBackend, { once: true })
      if (combinedSignal?.aborted) abortBackend()
      onEvent?.({
        type: 'backend.bound',
        backendRef: {
          provider: this.protocol,
          role: 'backend',
          sessionId: session.id,
          directory: this.directory,
          runId,
        },
      })
      const stopObserving = this.events.subscribe({
        sessionId: session.id,
        directory: this.directory,
        onEvent: event => {
          const activity = eventActivity(event)
          if (activity) onEvent?.({ type: 'backend.activity', activity })
        },
      })
      try {
        await this.events.ready?.(1000)
        const response = await this.request(
          `/session/${encodeURIComponent(session.id)}/message`,
          {
            headers: this.headers(),
            signal: combinedSignal,
            timeoutMs: 0,
            body: {
              messageID: runId,
              agent: backendAgent,
              ...(modelRef(this.model) ? { model: modelRef(this.model) } : {}),
              ...(this.mode === 'compatible'
                ? { system: BACKEND_AGENT_INSTRUCTIONS }
                : {}),
              parts: [{ type: 'text', text: String(message) }],
            },
          },
        )
        const payload = await response.json()
        const failure = responseFailure(payload)
        if (failure) {
          throw new AgentError(`OpenCode 执行失败：${failure}`, {
            body: JSON.stringify(payload),
            protocol: this.protocol,
          })
        }
        const content = responseText(payload)
        if (!content) {
          throw new AgentError('OpenCode 返回了空结果', {
            body: JSON.stringify(payload),
            protocol: this.protocol,
          })
        }
        return {
          content,
          raw: payload,
          protocol: this.protocol,
          metadata: {
            backendRef: {
              provider: this.protocol,
              role: 'backend',
              sessionId: session.id,
              directory: this.directory,
              runId,
              messageId: payload?.info?.id || null,
            },
          },
        }
      } finally {
        combinedSignal?.removeEventListener('abort', abortBackend)
        if (abortPromise) await abortPromise
        stopObserving()
      }
    })
  }
}
