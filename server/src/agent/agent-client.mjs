import { config } from '../core/config.mjs'
import { AgentError } from './backend-adapter.mjs'
import { OpenClawAdapter } from './openclaw-adapter.mjs'
import { OpenCodeAdapter } from './opencode-adapter.mjs'
import { QoderAdapter } from './qoder-adapter.mjs'

export { AgentError }

export function agentSessionKey(ownerId, role = 'backend') {
  return `qwen-audio-agent:${encodeURIComponent(String(ownerId || 'personal'))}:${role}`
}

export class AgentClient {
  constructor({
    fetchImpl = fetch,
    protocol = config.agentProtocol,
    mode = config.backendMode,
    permissionMode = config.backendPermissionMode,
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
    qoderModel = config.qoderModel,
    qoderDirectory = config.qoderDirectory,
    qoderConfigDirectory = config.qoderConfigDirectory,
    qoderCliPath = config.qoderCliPath,
    qoderAuthMode = config.qoderAuthMode,
    qoderTokenEnv = config.qoderTokenEnv,
    qoderSdk,
    WebSocketImpl,
  } = {}) {
    const Adapter = protocol === 'openclaw'
      ? OpenClawAdapter
      : protocol === 'qoder'
        ? QoderAdapter
        : OpenCodeAdapter
    this.adapter = new Adapter({
      ...(protocol === 'qoder' && qoderSdk ? { sdk: qoderSdk } : {}),
      fetchImpl,
      baseUrl: protocol === 'openclaw'
        ? openClawBaseUrl
        : protocol === 'qoder'
          ? ''
          : baseUrl,
      model: protocol === 'qoder' ? qoderModel : model,
      mode,
      permissionMode,
      timeoutMs,
      directory: protocol === 'qoder' ? qoderDirectory : directory,
      configDirectory: qoderConfigDirectory,
      cliPath: qoderCliPath,
      authMode: qoderAuthMode,
      tokenEnv: qoderTokenEnv,
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

  cancelDelegatedWork(workId, options = {}) {
    if (!this.adapter.cancelDelegatedWork) {
      throw new AgentError('当前后台 Agent 不支持取消第三层 Session', {
        protocol: this.protocol,
      })
    }
    return this.adapter.cancelDelegatedWork(workId, options)
  }

  queryDelegatedWork(workId, question, options = {}) {
    if (!this.adapter.queryDelegatedWork) {
      throw new AgentError('当前后台 Agent 不支持查询第三层 Session', {
        protocol: this.protocol,
      })
    }
    return this.adapter.queryDelegatedWork(workId, question, options)
  }

  uiUrl(options = {}) {
    return this.adapter.uiUrl?.(options.ownerId)
      || Promise.resolve(this.adapter.describe().baseUrl)
  }

  close() {
    return this.adapter.close?.() || Promise.resolve()
  }
}

export const agent = new AgentClient()
