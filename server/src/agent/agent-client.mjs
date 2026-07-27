import { config } from '../core/config.mjs'
import { AgentError } from './backend-adapter.mjs'
import { OpenClawAdapter } from './openclaw-adapter.mjs'
import { OpenCodeAdapter } from './opencode-adapter.mjs'

export { AgentError }

export function agentSessionKey(ownerId, role = 'backend') {
  return `qwen-audio-agent:${encodeURIComponent(String(ownerId || 'personal'))}:${role}`
}

export class AgentClient {
  constructor({
    fetchImpl = fetch,
    protocol = config.agentProtocol,
    mode = config.backendMode,
    baseUrl = config.openCodeBaseUrl,
    model = protocol === 'openclaw'
      ? config.openClawModel
      : config.openCodeModel,
    timeoutMs = config.agentTimeoutMs,
    directory = config.openCodeDirectory,
    username = config.openCodeUsername,
    password = config.openCodePassword,
    coordinatorAgent = config.openCodeCoordinatorAgent,
    openClawBaseUrl = config.openClawBaseUrl,
    openClawToken = config.openClawToken,
    openClawCoordinatorAgent = config.openClawCoordinatorAgent,
    WebSocketImpl,
  } = {}) {
    const Adapter = protocol === 'openclaw' ? OpenClawAdapter : OpenCodeAdapter
    this.adapter = new Adapter({
      fetchImpl,
      baseUrl: protocol === 'openclaw' ? openClawBaseUrl : baseUrl,
      model,
      mode,
      timeoutMs,
      directory,
      username,
      password,
      coordinatorAgent: protocol === 'openclaw'
        ? openClawCoordinatorAgent
        : coordinatorAgent,
      token: openClawToken,
      WebSocketImpl,
    })
  }

  get protocol() {
    return this.adapter.protocol
  }

  get label() {
    return this.adapter.label
  }

  describe() {
    return this.adapter.describe()
  }

  async health() {
    try {
      return await this.adapter.health()
    } catch (error) {
      return { ok: false, error: error.message, protocol: this.protocol }
    }
  }

  runCoordinator(message, options = {}) {
    return this.adapter.runCoordinator(message, options)
  }

  respondPermission(id, decision, options = {}) {
    if (!this.adapter.respondPermission) {
      throw new AgentError('当前后台 Agent 不支持权限确认', {
        protocol: this.protocol,
      })
    }
    return this.adapter.respondPermission(id, decision, options)
  }

  uiUrl(options = {}) {
    return this.adapter.uiUrl?.(options.ownerId)
      || Promise.resolve(this.adapter.describe().baseUrl)
  }
}

export const agent = new AgentClient()
