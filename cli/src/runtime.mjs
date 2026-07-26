import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import {
  loadRuntimeEnvironment,
  requireDashScopeCredential,
} from '../../shared/runtime-environment.mjs'
import {
  readGatewayHealth,
} from '../../shared/gateway-client.mjs'

export {
  readGatewayHealth,
} from '../../shared/gateway-client.mjs'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function isLocalGateway(baseUrl) {
  return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname)
}

function normalizedOrigin(value) {
  return new URL(value).origin
}

export function resolveBackend(options = {}, env = process.env) {
  const protocol = String(
    options.backend || env.AGENT_PROTOCOL || 'opencode',
  ).toLowerCase()
  if (!['opencode', 'openclaw'].includes(protocol)) {
    throw new Error(`不支持的后台 Agent：${protocol}`)
  }
  const configured = protocol === 'openclaw'
    ? env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789'
    : env.OPENCODE_BASE_URL || 'http://127.0.0.1:4096'
  return {
    protocol,
    mode: String(
      options.backendMode || env.QWEN_AUDIO_AGENT_BACKEND_MODE || 'managed',
    ).toLowerCase(),
    agentId: String(
      options.backendAgent || env.QWEN_AUDIO_AGENT_BACKEND_AGENT || '',
    ).trim(),
    baseUrl: normalizedOrigin(options.backendUrl || configured),
  }
}

export function assertGatewayCompatibility(health, backend) {
  const actualProtocol = health?.backend?.kind || health?.backend?.protocol
  const actualBaseUrl = health?.backend?.baseUrl
  const actualMode = health?.backend?.mode
  if (!actualProtocol || !actualBaseUrl) {
    throw new Error('现有 Gateway 未报告完整的后台 Agent 配置，无法安全复用')
  }
  if (
    actualProtocol !== backend.protocol
    || (
      backend.mode !== 'managed'
      && normalizedOrigin(actualBaseUrl) !== backend.baseUrl
    )
  ) {
    throw new Error(
      `现有 Gateway 使用 ${actualProtocol} (${actualBaseUrl})，`
      + `与当前配置 ${backend.protocol} (${backend.baseUrl}) 不一致`,
    )
  }
  if (actualMode && backend.mode && actualMode !== backend.mode) {
    throw new Error(
      `现有 Gateway 使用 ${actualMode} 模式，`
      + `与当前配置 ${backend.mode} 模式不一致`,
    )
  }
}

export async function waitForGateway(baseUrl, {
  fetchImpl = fetch,
  requireBackend = false,
  timeoutMs = 45000,
  intervalMs = 200,
} = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await readGatewayHealth(baseUrl, fetchImpl)
    if (health && (!requireBackend || health.backend?.ok === true)) {
      return health
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error(
    requireBackend
      ? `后台 Agent 启动超时：${baseUrl}`
      : `Gateway 启动超时：${baseUrl}`,
  )
}

function waitForReadiness(child, readiness, label) {
  return new Promise((resolve, reject) => {
    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`${label} 在就绪前退出：${code ?? signal ?? 'unknown'}`))
    }
    const onError = error => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      child.off('exit', onExit)
      child.off('error', onError)
    }
    child.once('exit', onExit)
    child.once('error', onError)
    readiness.then(value => {
      cleanup()
      resolve(value)
    }, error => {
      cleanup()
      reject(error)
    })
  })
}

function backendEnvironment(env, backend) {
  const target = new URL(backend.baseUrl)
  const next = {
    ...env,
    AGENT_PROTOCOL: backend.protocol,
    QWEN_AUDIO_AGENT_BACKEND_MODE: backend.mode,
    ...(backend.agentId
      ? { QWEN_AUDIO_AGENT_BACKEND_AGENT: backend.agentId }
      : {}),
  }
  if (backend.protocol === 'openclaw') {
    next.OPENCLAW_BASE_URL = backend.baseUrl
    next.OPENCLAW_PORT = target.port || (target.protocol === 'https:' ? '443' : '80')
  } else {
    next.OPENCODE_BASE_URL = backend.baseUrl
    next.OPENCODE_PORT = target.port || (target.protocol === 'https:' ? '443' : '80')
  }
  return next
}

function gatewaySpawn(root, platform, env, target, options) {
  return {
    command: process.execPath,
    args: [resolve(root, 'server/src/index.mjs')],
    options: {
      cwd: resolve(root, 'server'),
      env: {
        ...env,
        // The desktop launcher runs inside Electron, so process.execPath points
        // at Electron rather than Node. Run the Gateway as a Node process to
        // prevent it from registering a second macOS Dock application.
        ELECTRON_RUN_AS_NODE: '1',
        HOST: options.listenHost
          || (target.hostname === 'localhost' ? '127.0.0.1' : target.hostname),
        PORT: String(options.listenPort || target.port || '80'),
      },
      detached: platform !== 'win32',
      stdio: 'inherit',
    },
  }
}

export class ManagedRuntime {
  constructor(children = [], {
    platform = process.platform,
    killImpl = process.kill,
  } = {}) {
    this.children = children
    this.platform = platform
    this.killImpl = killImpl
  }

  get ownsProcesses() {
    return this.children.length > 0
  }

  close(signal = 'SIGTERM') {
    for (const child of this.children) {
      if (child.exitCode == null && child.signalCode == null) {
        if (this.platform !== 'win32' && Number.isInteger(child.pid)) {
          try {
            // Managed services are spawned as process-group leaders. Signalling
            // the group also stops npm's Node/OpenCode descendants.
            this.killImpl(-child.pid, signal)
            continue
          } catch {
            // Fall back to the direct child if it exited between the checks.
          }
        }
        child.kill(signal)
      }
    }
  }

  async closeUnlessShared(
    baseUrl,
    signal = 'SIGTERM',
    fetchImpl = fetch,
  ) {
    if (!this.ownsProcesses) return false
    const health = await readGatewayHealth(baseUrl, fetchImpl)
    if ((health?.voiceClients?.byType?.desktop || 0) > 0) return false
    this.close(signal)
    return true
  }

  wait() {
    if (!this.children.length) return Promise.resolve(0)
    return Promise.race(this.children.map(child => (
      new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => {
          if (signal === 'SIGINT' || signal === 'SIGTERM') resolve(0)
          else resolve(code ?? 1)
        })
      })
    ))).finally(() => this.close())
  }
}

export async function ensureRuntime(options, {
  root,
  env = process.env,
  fetchImpl = fetch,
  spawnImpl = spawn,
  platform = process.platform,
  loadEnvironment = () => loadRuntimeEnvironment({ root, env }),
  requireCredential = () => requireDashScopeCredential(env),
} = {}) {
  loadEnvironment()
  const runtime = new ManagedRuntime([], { platform })
  const local = isLocalGateway(options.url)
  const backend = resolveBackend(options, env)
  let health = await readGatewayHealth(options.url, fetchImpl)
  const existingGateway = Boolean(health)

  try {
    if (!health) {
      if (!local) throw new Error(`无法连接远程 Gateway：${options.url}`)
      if (options.allowMissingCredential !== true) requireCredential()
      const target = new URL(options.url)
      if (target.protocol !== 'http:') {
        throw new Error('本地自动启动 Gateway 只支持 http 地址')
      }
      Object.assign(env, backendEnvironment(env, backend))
      const spec = gatewaySpawn(
        root,
        platform,
        backendEnvironment(env, backend),
        target,
        options,
      )
      const gateway = spawnImpl(spec.command, spec.args, spec.options)
      runtime.children.push(gateway)
      health = await waitForReadiness(
        gateway,
        waitForGateway(options.url, {
          fetchImpl,
          requireBackend: options.waitForBackend !== false,
        }),
        'Gateway',
      )
    }

    // A managed Gateway may move its private backend to a free local port.
    // Existing Gateways must still match the requested protocol and mode.
    if (existingGateway || backend.mode === 'compatible') {
      assertGatewayCompatibility(health, backend)
    } else {
      const actualProtocol = health?.backend?.kind || health?.backend?.protocol
      if (actualProtocol !== backend.protocol) {
        throw new Error(
          `Gateway 启动了 ${actualProtocol || '未知'} 后台，`
          + `与当前配置 ${backend.protocol} 不一致`,
        )
      }
    }
    if (
      health.voiceConfigured === false
      && options.allowMissingCredential !== true
    ) {
      throw new Error(
        '现有 Gateway 未配置 DashScope 凭据；请修正配置后重启该 Gateway',
      )
    }

    if (health.backend?.ok !== true && options.waitForBackend !== false) {
      throw new Error(
        backend.mode === 'compatible'
          ? `兼容模式不会启动后台 Agent，请先启动并检查 ${backend.baseUrl}`
          : `Gateway 管理的后台 Agent 未就绪：${health.backend?.baseUrl || backend.baseUrl}`,
      )
    }

    return runtime
  } catch (error) {
    runtime.close()
    throw error
  }
}
