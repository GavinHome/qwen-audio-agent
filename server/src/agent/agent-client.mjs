import { config } from '../core/config.mjs'
import { AgentError } from './backend-adapter.mjs'
import { AcpBackendAdapter } from './acp-backend-adapter.mjs'
import { backendDriver } from './backends/registry.mjs'

export { AgentError }

export class AgentClient {
  constructor({
    protocol = config.agentProtocol,
    mode = config.backendMode,
    permissionMode = config.backendPermissionMode,
    baseUrl = config.openCodeBaseUrl,
    model,
    timeoutMs = config.agentTimeoutMs,
    directory = config.openCodeDirectory,
    coordinatorAgent = config.openCodeCoordinatorAgent,
    openClawBaseUrl = config.openClawBaseUrl,
    openClawToken = config.openClawToken,
    openClawTokenFile = config.openClawTokenFile,
    openClawCoordinatorAgent = config.openClawCoordinatorAgent,
    openClawDirectory = config.openClawDirectory,
    qoderModel = config.qoderModel,
    qoderDirectory = config.qoderDirectory,
    qoderConfigDirectory = config.qoderConfigDirectory,
    qoderCliPath = config.qoderCliPath,
    hermesDirectory = config.hermesDirectory,
    hermesCliPath = config.hermesCliPath,
    codeBuddyModel = config.codeBuddyModel,
    codeBuddyModelUrl = config.codeBuddyModelUrl,
    codeBuddyDirectory = config.codeBuddyDirectory,
    codeBuddyCliPath = config.codeBuddyCliPath,
    codexModel = config.codexModel,
    codexModelUrl = config.codexModelUrl,
    codexDirectory = config.codexDirectory,
    codexCliPath = config.codexCliPath,
    acpCommand = config.acpCommand,
    acpArgs = config.acpArgs,
    acpLabel = config.acpLabel,
    acpDirectory = config.acpDirectory,
    acpModel = config.acpModel,
    acpCoordinatorAgent = config.acpCoordinatorAgent,
    sessionStatePath = config.backendSessionStatePath,
    acpClient,
    acpClientFactory,
    sessionToolServer,
  } = {}) {
    const driver = backendDriver(protocol)
    const options = driver.resolveOptions({
      baseUrl,
      model,
      openCodeModel: config.openCodeModel,
      openClawModel: config.openClawModel,
      directory,
      coordinatorAgent,
      openClawBaseUrl,
      openClawToken,
      openClawTokenFile,
      openClawCoordinatorAgent,
      openClawDirectory,
      qoderModel,
      qoderDirectory,
      qoderConfigDirectory,
      qoderCliPath,
      hermesDirectory,
      hermesCliPath,
      codeBuddyModel,
      codeBuddyModelUrl,
      codeBuddyDirectory,
      codeBuddyCliPath,
      codexModel,
      codexModelUrl,
      codexDirectory,
      codexCliPath,
      acpCommand,
      acpArgs,
      acpLabel,
      acpDirectory,
      acpModel,
      acpCoordinatorAgent,
    })
    const profile = driver.createProfile({
      protocol,
      root: config.root,
      permissionMode,
      ...options,
    })
    this.adapter = new AcpBackendAdapter({
      protocol,
      root: config.root,
      mode,
      permissionMode,
      timeoutMs,
      ...options,
      profile,
      nativeDelegationAdapter:
        driver.createNativeDelegationAdapter?.(options) || null,
      sessionStatePath,
      ...(acpClient ? { client: acpClient } : {}),
      ...(acpClientFactory ? { clientFactory: acpClientFactory } : {}),
      ...(sessionToolServer ? { sessionToolServer } : {}),
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

  canRecoverDelegatedWork(task) {
    return this.adapter.canRecoverDelegatedWork?.(task) === true
  }

  recoverDelegatedWork(task, options = {}) {
    if (!this.adapter.recoverDelegatedWork) {
      throw new AgentError('当前后台 Agent 不支持恢复第三层 Session', {
        protocol: this.protocol,
      })
    }
    return this.adapter.recoverDelegatedWork(task, options)
  }

  uiUrl(options = {}) {
    return this.adapter.uiUrl?.(options.ownerId) || Promise.resolve(null)
  }

  close() {
    return this.adapter.close?.() || Promise.resolve()
  }
}

export const agent = new AgentClient()
