import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadRuntimeEnvironment } from '../../shared/runtime-environment.mjs'
import { helpText, parseArguments } from './arguments.mjs'
import {
  ensureRuntime,
  readGatewayHealth,
  waitForGateway,
} from './runtime.mjs'
import { launchWebUi } from './webui.mjs'
import { acquireCliInstance } from './instance-lock.mjs'
import { manageGatewayService } from './gateway-service.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const gatewayPath = resolve(root, 'server/src/index.mjs')

async function runMinimal(options) {
  const moduleUrl = pathToFileURL(resolve(root, 'tui/src/index.mjs'))
  const { runTui } = await import(moduleUrl)
  await runTui({
    url: options.url,
    sessionId: options.sessionId,
    audioMode: options.audioMode,
    takeover: options.takeover,
  })
  return 0
}

function applyGatewayOptions(env, options) {
  env.AGENT_PROTOCOL = options.backend
  env.QWEN_AUDIO_AGENT_BACKEND_MODE = options.backendMode
  env.QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE = options.backendPermissionMode
  if (options.backendAgent) {
    env.QWEN_AUDIO_AGENT_BACKEND_AGENT = options.backendAgent
  } else {
    delete env.QWEN_AUDIO_AGENT_BACKEND_AGENT
  }
  if (options.backend === 'openclaw') {
    env.OPENCLAW_BASE_URL = options.backendUrl
  } else if (options.backend === 'opencode') {
    env.OPENCODE_BASE_URL = options.backendUrl
  }
}

function gatewaySummary(health) {
  const label = health?.backend?.label
    || health?.backend?.kind
    || health?.backend?.protocol
    || '后台 Agent'
  const state = health?.backend?.ok ? '已连接' : '未连接'
  return `${label} ${state}`
}

async function waitForGatewayStop(url, {
  inspectGateway = readGatewayHealth,
  timeoutMs = 15_000,
  intervalMs = 100,
} = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!await inspectGateway(url)) return
    await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs))
  }
  throw new Error(`Gateway 停止超时：${url}`)
}

export async function main(argv, {
  env = process.env,
  stdout = process.stdout,
  signalSource = process,
  prepareEnvironment = () => loadRuntimeEnvironment({ root, env }),
  runMinimalTui = runMinimal,
  prepareRuntime = options => ensureRuntime(options, { root, env }),
  inspectGateway = url => readGatewayHealth(url),
  manageService = (action, options) => manageGatewayService(action, options),
  waitForService = url => waitForGateway(url, { requireBackend: true }),
  waitForServiceStop = url => waitForGatewayStop(url, { inspectGateway }),
  runWebUi = options => launchWebUi(options),
  acquireInstance = directory => acquireCliInstance(directory),
} = {}) {
  const environment = prepareEnvironment()
  const options = parseArguments(argv, env)
  if (options.help) {
    stdout.write(`${helpText()}\n`)
    return 0
  }
  if (options.command === 'config') {
    stdout.write(`${environment.configPath
      || resolve(environment.configDirectory, 'config.env')}\n`)
    return 0
  }

  if (
    (options.command === 'gateway' && options.gatewayAction !== 'run')
    || options.command === 'status'
  ) {
    const serviceOptions = {
      configDirectory: environment.configDirectory,
      gatewayPath,
      serviceMetadata: {
        url: options.url,
      },
    }
    if (options.gatewayAction === 'status') {
      const service = await manageService('status', serviceOptions)
      const serviceUrl = service.installedMetadata?.url || options.url
      const health = await inspectGateway(serviceUrl)
      stdout.write(
        `Gateway 后台服务：${
          service.running
            ? '运行中'
            : service.installed ? '已停止' : '未安装'
        }\n`
        + `连接状态：${health ? gatewaySummary(health) : '未连接'}\n`
        + `地址：${serviceUrl}\n`,
      )
      return service.running && health ? 0 : 1
    }

    const current = await manageService('status', serviceOptions)
    const currentUrl = current.installedMetadata?.url || options.url
    const health = await inspectGateway(currentUrl)
    if (
      ['install', 'start', 'restart'].includes(options.gatewayAction)
      && health
      && !current.running
    ) {
      throw new Error(
        'Gateway 正在前台运行；请先结束前台进程，再启动后台服务',
      )
    }
    const service = await manageService(
      options.gatewayAction,
      serviceOptions,
    )
    const serviceUrl = service.installedMetadata?.url || currentUrl
    if (['install', 'start', 'restart'].includes(options.gatewayAction)) {
      const ready = await waitForService(serviceUrl)
      stdout.write(
        `Gateway 后台服务已${
          options.gatewayAction === 'restart' ? '重启' : '启动'
        }：${serviceUrl}\n`
        + `${gatewaySummary(ready)}\n`,
      )
    } else {
      if (health && current.running) await waitForServiceStop(currentUrl)
      stdout.write(
        options.gatewayAction === 'uninstall'
          ? 'Gateway 后台服务已移除\n'
          : 'Gateway 后台服务已停止\n',
      )
    }
    if (service.logPath) stdout.write(`日志：${service.logPath}\n`)
    return 0
  }

  if (options.command === 'gateway') {
    applyGatewayOptions(env, options)
    const runtime = await prepareRuntime(options)
    const health = await inspectGateway(options.url)
    stdout.write(
      `Gateway ${runtime.ownsProcesses ? '已启动' : '已在运行'}：${options.url}\n`
      + `WebUI：${options.url}/\n`
      + `${gatewaySummary(health)}\n`,
    )
    if (!runtime.ownsProcesses) return 0
    const onSigint = () => runtime.close('SIGINT')
    const onSigterm = () => runtime.close('SIGTERM')
    signalSource.once('SIGINT', onSigint)
    signalSource.once('SIGTERM', onSigterm)
    try {
      return await runtime.wait()
    } finally {
      signalSource.off('SIGINT', onSigint)
      signalSource.off('SIGTERM', onSigterm)
      runtime.close()
    }
  }

  const health = await inspectGateway(options.url)
  if (!health) {
    throw new Error(
      `Gateway 未运行：${options.url}。请先执行 qwenaudio gateway`,
    )
  }
  if (options.command === 'webui') return runWebUi(options)

  const instance = acquireInstance(environment.configDirectory)
  try {
    return await runMinimalTui(options)
  } finally {
    instance.release()
  }
}
