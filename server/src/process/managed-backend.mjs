import { spawn } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { resolve } from 'node:path'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function origin(value) {
  return new URL(value).origin
}

function permissionMode(env) {
  const mode = String(
    env.QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE || 'native',
  ).toLowerCase()
  if (!['native', 'full'].includes(mode)) {
    throw new Error(`不支持的后台权限模式：${mode}（可选 native、full）`)
  }
  return mode
}

export function resolveManagedBackend(env = process.env) {
  const protocol = String(env.AGENT_PROTOCOL || 'opencode').toLowerCase()
  if (!['opencode', 'openclaw', 'qoder'].includes(protocol)) {
    throw new Error(`不支持的后台 Agent：${protocol}`)
  }
  const mode = String(
    env.QWEN_AUDIO_AGENT_BACKEND_MODE || 'managed',
  ).toLowerCase()
  const resolvedPermissionMode = permissionMode(env)
  if (!['managed', 'compatible'].includes(mode)) {
    throw new Error(`不支持的后台模式：${mode}`)
  }
  if (resolvedPermissionMode === 'full' && mode !== 'managed') {
    throw new Error('最高权限模式只支持由 Gateway 管理的后台 Agent')
  }
  if (resolvedPermissionMode === 'full' && protocol === 'openclaw') {
    throw new Error(
      'OpenClaw 的最高权限需要单独配置 exec approvals、elevated 和 host，'
      + '不能由 Gateway 的统一权限开关安全启用',
    )
  }
  if (protocol === 'qoder') {
    if (mode !== 'managed') {
      throw new Error('Qoder 后台当前只支持 managed 模式')
    }
    return {
      protocol,
      mode,
      permissionMode: resolvedPermissionMode,
      baseUrl: null,
    }
  }
  const configured = protocol === 'openclaw'
    ? env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789'
    : env.OPENCODE_BASE_URL || 'http://127.0.0.1:4096'
  return {
    protocol,
    mode,
    permissionMode: resolvedPermissionMode,
    baseUrl: origin(configured),
  }
}

function inlineOpenCodeConfig(value) {
  if (!String(value || '').trim()) return {}
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('OPENCODE_CONFIG_CONTENT 不是有效的 JSON')
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('OPENCODE_CONFIG_CONTENT 必须是 JSON 对象')
  }
  return parsed
}

export function applyBackendPermissionMode(env, backend) {
  if (backend.permissionMode !== 'full') return env
  if (backend.mode !== 'managed') {
    throw new Error('最高权限模式只支持由 Gateway 管理的后台 Agent')
  }
  if (backend.protocol === 'openclaw') {
    throw new Error('OpenClaw 不支持 Gateway 统一最高权限模式')
  }
  if (backend.protocol !== 'opencode') return env

  const config = inlineOpenCodeConfig(env.OPENCODE_CONFIG_CONTENT)
  const agents = {
    ...(config.agent && typeof config.agent === 'object' ? config.agent : {}),
  }
  const names = new Set([
    String(
      env.QWEN_AUDIO_AGENT_BACKEND_AGENT
      || env.OPENCODE_COORDINATOR_AGENT
      || 'qwen-audio-agent-backend',
    ).trim(),
    String(env.OPENCODE_TASK_AGENT || 'build').trim(),
  ])
  for (const name of names) {
    if (!name) continue
    const existing = agents[name]
    agents[name] = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      permission: 'allow',
    }
  }
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    ...config,
    permission: 'allow',
    agent: agents,
  })
  return env
}

export function isLocalBackend(baseUrl) {
  return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname)
}

export function backendAddressInUse(baseUrl, timeoutMs = 300) {
  const target = new URL(baseUrl)
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80))
  return new Promise(resolvePromise => {
    const socket = createConnection({ host: target.hostname, port })
    const finish = value => {
      socket.destroy()
      resolvePromise(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export function allocateBackendAddress(baseUrl) {
  const target = new URL(baseUrl)
  const host = target.hostname === 'localhost' ? '127.0.0.1' : target.hostname
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    server.unref()
    server.once('error', rejectPromise)
    server.listen(0, host, () => {
      const address = server.address()
      server.close(error => {
        if (error) return rejectPromise(error)
        target.hostname = host
        target.port = String(address.port)
        resolvePromise(target.origin)
      })
    })
  })
}

function applyBackendAddress(env, backend) {
  const target = new URL(backend.baseUrl)
  if (backend.protocol === 'openclaw') {
    env.OPENCLAW_BASE_URL = backend.baseUrl
    env.OPENCLAW_PORT = target.port || (target.protocol === 'https:' ? '443' : '80')
  } else {
    env.OPENCODE_BASE_URL = backend.baseUrl
    env.OPENCODE_PORT = target.port || (target.protocol === 'https:' ? '443' : '80')
  }
}

function spawnSpec(root, platform, env) {
  const childEnvironment = {
    ...env,
    QWEN_AUDIO_AGENT_ENV_LOADED: '1',
    QWEN_AUDIO_AGENT_NODE: process.execPath,
  }
  if (platform === 'win32') {
    return {
      command: 'npm.cmd',
      args: ['run', 'backend'],
      options: {
        cwd: root,
        env: childEnvironment,
        detached: false,
        stdio: 'inherit',
      },
    }
  }
  return {
    command: resolve(root, 'scripts/backend'),
    args: [],
    options: {
      cwd: root,
      env: childEnvironment,
      detached: true,
      stdio: 'inherit',
    },
  }
}

export class ManagedBackendRuntime {
  constructor(child = null, {
    platform = process.platform,
    killImpl = process.kill,
  } = {}) {
    this.child = child
    this.platform = platform
    this.killImpl = killImpl
  }

  get ownsProcess() {
    return Boolean(this.child)
  }

  close(signal = 'SIGTERM') {
    const child = this.child
    if (!child || child.exitCode != null || child.signalCode != null) return
    if (this.platform !== 'win32' && Number.isInteger(child.pid)) {
      try {
        this.killImpl(-child.pid, signal)
        return
      } catch {
        // The group may have exited between the status check and signal.
      }
    }
    child.kill(signal)
  }
}

export async function startManagedBackend({
  root,
  env = process.env,
  platform = process.platform,
  spawnImpl = spawn,
  isAddressInUse = backendAddressInUse,
  findFreeAddress = allocateBackendAddress,
} = {}) {
  const backend = resolveManagedBackend(env)
  applyBackendPermissionMode(env, backend)
  if (backend.protocol === 'qoder') {
    return new ManagedBackendRuntime(null, { platform })
  }
  if (backend.mode === 'compatible') {
    return new ManagedBackendRuntime(null, { platform })
  }
  if (backend.mode !== 'managed') {
    throw new Error(`不支持的后台模式：${backend.mode}`)
  }
  if (!isLocalBackend(backend.baseUrl)) {
    throw new Error(`增强模式只能管理本机后台 Agent：${backend.baseUrl}`)
  }
  if (await isAddressInUse(backend.baseUrl)) {
    backend.baseUrl = await findFreeAddress(backend.baseUrl)
  }
  applyBackendAddress(env, backend)
  const spec = spawnSpec(root, platform, env)
  const child = spawnImpl(spec.command, spec.args, spec.options)
  child.once?.('error', error => {
    process.stderr.write(`后台 Agent 进程启动失败：${error.message}\n`)
  })
  return new ManagedBackendRuntime(child, { platform })
}
