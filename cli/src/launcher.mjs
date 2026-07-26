import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadRuntimeEnvironment } from '../../shared/runtime-environment.mjs'
import { helpText, parseArguments } from './arguments.mjs'
import { ensureRuntime, readGatewayHealth } from './runtime.mjs'
import { launchWebUi } from './webui.mjs'
import { acquireCliInstance } from './instance-lock.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function childExit(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (signal === 'SIGINT' || signal === 'SIGTERM') resolvePromise(0)
      else resolvePromise(code ?? 1)
    })
  })
}

async function runMinimal(options) {
  const moduleUrl = pathToFileURL(resolve(root, 'tui/src/index.mjs'))
  const { runTui } = await import(moduleUrl)
  await runTui({
    url: options.url,
    sessionId: options.sessionId,
    takeover: options.takeover,
  })
  return 0
}

function runFull(options, spawnImpl = spawn) {
  const child = spawnImpl(
    process.env.PYTHON || 'python3',
    [
      resolve(root, 'tui/fullscreen/app.py'),
      '--url',
      options.url,
      '--session',
      options.sessionId,
      ...(options.takeover ? ['--takeover'] : []),
    ],
    { cwd: root, stdio: 'inherit' },
  )
  return childExit(child)
}

function applyGatewayOptions(env, options) {
  env.AGENT_PROTOCOL = options.backend
  env.QWEN_AUDIO_AGENT_BACKEND_MODE = options.backendMode
  if (options.backendAgent) {
    env.QWEN_AUDIO_AGENT_BACKEND_AGENT = options.backendAgent
  } else {
    delete env.QWEN_AUDIO_AGENT_BACKEND_AGENT
  }
  if (options.backend === 'openclaw') {
    env.OPENCLAW_BASE_URL = options.backendUrl
  } else {
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

export async function main(argv, {
  env = process.env,
  stdout = process.stdout,
  signalSource = process,
  prepareEnvironment = () => loadRuntimeEnvironment({ root, env }),
  runMinimalTui = runMinimal,
  runFullTui = runFull,
  prepareRuntime = options => ensureRuntime(options, { root, env }),
  inspectGateway = url => readGatewayHealth(url),
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
  if (options.command === 'status') {
    stdout.write(
      `Gateway 已连接：${options.url}\n`
      + `${gatewaySummary(health)}\n`,
    )
    return 0
  }
  if (options.command === 'webui') return runWebUi(options)

  const instance = acquireInstance(environment.configDirectory)
  try {
    if (options.mode === 'full') return await runFullTui(options)
    return await runMinimalTui(options)
  } finally {
    instance.release()
  }
}
