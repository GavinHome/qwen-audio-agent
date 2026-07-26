import { BackendAdapter } from './backend-adapter.mjs'
import { compatibleBackendMessage } from './backend-agent-instructions.mjs'
import { OpenClawGatewayClient } from './openclaw-gateway-client.mjs'

const MANAGED_AGENT = 'qwen-audio-agent-backend'

function sessionKey(ownerId, agentId) {
  const owner = encodeURIComponent(String(ownerId || 'personal')).toLowerCase()
  return `agent:${agentId}:qwen-audio-agent:${owner}:backend`
}

function toolCategory(name, args) {
  const hint = `${name || ''} ${JSON.stringify(args || {})}`.toLowerCase()
  if (/image|draw|canvas|图片|图像|绘图/.test(hint)) return 'image'
  if (/search|web|fetch|browser|搜索|查询/.test(hint)) return 'search'
  if (/read|glob|grep|list|读取|查找/.test(hint)) return 'read'
  if (/write|edit|patch|写入|修改/.test(hint)) return 'write'
  return 'run'
}

export function openClawActivity(event) {
  if (event?.stream === 'assistant') {
    return { kind: 'text', status: 'running' }
  }
  if (event?.stream !== 'tool') return null
  const data = event.data || {}
  return {
    id: data.toolCallId || null,
    kind: 'tool',
    tool: data.name || 'tool',
    status: data.phase === 'result' ? 'completed' : 'running',
    category: toolCategory(data.name, data.args),
    detail: '',
  }
}

export class OpenClawAdapter extends BackendAdapter {
  protocol = 'openclaw'

  constructor(options) {
    super(options)
    this.mode = options.mode === 'compatible' ? 'compatible' : 'managed'
    this.agentId = String(options.coordinatorAgent || '').trim()
      || (this.mode === 'managed' ? MANAGED_AGENT : '')
    this.resolvedAgentId = null
    this.gateway = new OpenClawGatewayClient({
      baseUrl: this.baseUrl,
      token: options.token,
      timeoutMs: this.timeoutMs,
      WebSocketImpl: options.WebSocketImpl,
    })
    this.queues = new Map()
  }

  get label() {
    return 'OpenClaw'
  }

  describe() {
    return {
      kind: 'openclaw',
      label: this.label,
      baseUrl: this.baseUrl,
      uiPath: '/api/backend/ui',
      model: this.model || null,
      mode: this.mode,
      backendAgent: this.resolvedAgentId || this.agentId || null,
      sessionModel: 'one-persistent-backend-agent',
      protocol: this.protocol,
    }
  }

  async health() {
    const payload = await this.gateway.call('health', {}, { timeoutMs: 5000 })
    const backendAgent = await this.resolveBackendAgent()
    return {
      ok: true,
      status: 200,
      version: payload?.version || null,
      protocol: this.protocol,
      mode: this.mode,
      backendAgent,
      enhanced: this.mode === 'managed',
    }
  }

  async resolveBackendAgent() {
    if (this.resolvedAgentId) return this.resolvedAgentId
    const payload = await this.gateway.listAgents()
    const agents = payload?.agents || []
    const selected = this.agentId
      ? agents.find(agent => agent?.id === this.agentId)
      : (
          agents.find(agent => agent?.id === payload?.defaultId)
          || agents[0]
        )
    if (!selected?.id) {
      throw new Error(
        this.agentId
          ? `OpenClaw 中不存在后台 Agent "${this.agentId}"`
          : 'OpenClaw 没有可用的后台 Agent',
      )
    }
    this.resolvedAgentId = selected.id
    return this.resolvedAgentId
  }

  serialize(key, operation) {
    const previous = this.queues.get(key) || Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    this.queues.set(key, current)
    return current.finally(() => {
      if (this.queues.get(key) === current) this.queues.delete(key)
    })
  }

  async runCoordinator(message, options = {}) {
    const backendAgent = await this.resolveBackendAgent()
    const key = sessionKey(options.ownerId, backendAgent)
    return this.serialize(key, async () => {
      options.onEvent?.({
        type: 'activity',
        activity: { kind: 'session', status: 'running' },
      })
      const result = await this.gateway.sendAndWait(
        key,
        this.mode === 'compatible' ? compatibleBackendMessage(message) : message,
        {
          signal: options.signal,
          timeoutMs: this.timeoutMs,
          onEvent: event => {
            const activity = openClawActivity(event)
            if (activity) options.onEvent?.({ type: 'activity', activity })
          },
        },
      )
      return {
        content: result.content,
        protocol: this.protocol,
        metadata: {
          backendSession: key,
          backendAgent,
          runId: result.runId,
        },
      }
    })
  }
}
