import { createConnection } from 'node:net'
import { resolve } from 'node:path'

function clean(value) {
  return String(value || '').trim()
}

export function endpointAvailable(value, timeoutMs = 300) {
  let target
  try {
    target = new URL(value)
  } catch {
    return Promise.resolve(false)
  }
  const port = Number(
    target.port || (target.protocol === 'https:' ? 443 : 80),
  )
  return new Promise(resolvePromise => {
    const socket = createConnection({
      host: target.hostname,
      port,
    })
    const finish = available => {
      socket.destroy()
      resolvePromise(available)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function websocketUrl(httpUrl) {
  const url = new URL(httpUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString().replace(/\/+$/, '')
}

export function acpBackendProfile({
  protocol,
  root,
  directory,
  cliPath,
  baseUrl,
  token,
  tokenFile,
  configDirectory,
  permissionMode,
  model,
}) {
  const environment = {
    ...process.env,
    QWEN_AUDIO_AGENT_ENV_LOADED: '1',
    QWEN_AUDIO_AGENT_NODE: process.execPath,
    ...(configDirectory ? { QODER_CONFIG_DIR: configDirectory } : {}),
  }
  if (protocol === 'qoder') {
    return {
      label: 'Qoder',
      command: cliPath || 'qodercli',
      args: [
        '--acp',
        ...(clean(model) && clean(model) !== 'auto'
          ? ['--model', clean(model)]
          : []),
        ...(permissionMode === 'full'
          ? ['--dangerously-skip-permissions']
          : []),
      ],
      cwd: directory,
      env: environment,
      externalMcp: true,
      nativeDelegation: false,
    }
  }
  if (protocol === 'openclaw') {
    return {
      label: 'OpenClaw',
      command: resolve(root, 'scripts/openclaw'),
      args: [
        'acp',
        '--url',
        websocketUrl(baseUrl),
        ...(clean(token) && clean(tokenFile)
          ? ['--token-file', clean(tokenFile)]
          : []),
        '--verbose',
      ],
      cwd: directory,
      env: {
        ...environment,
        ...(token ? { OPENCLAW_GATEWAY_TOKEN: token } : {}),
      },
      externalMcp: false,
      nativeDelegation: true,
    }
  }
  return {
    label: 'OpenCode',
    command: resolve(root, 'scripts/opencode-acp'),
    args: [],
    cwd: directory,
    env: environment,
    externalMcp: true,
    nativeDelegation: false,
  }
}
