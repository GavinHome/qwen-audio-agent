import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRuntimeEnvironment } from '../../shared/runtime-environment.mjs'
import { startManagedBackend } from './process/managed-backend.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
loadRuntimeEnvironment({ root })

let backendRuntime
let agentClient
let stopPromise

function stop(signal = 'SIGTERM') {
  if (stopPromise) return stopPromise
  backendRuntime?.close(signal)
  stopPromise = Promise.resolve(agentClient?.close()).catch(error => {
    process.stderr.write(`后台 Agent 停止失败：${error.message}\n`)
  })
  return stopPromise
}

try {
  backendRuntime = await startManagedBackend({ root })
  const agentModule = await import('./agent/agent-client.mjs')
  agentClient = agentModule.agent
  process.once('SIGINT', () => {
    stop('SIGINT').finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    stop('SIGTERM').finally(() => process.exit(0))
  })
  process.once('exit', () => {
    backendRuntime?.close()
    agentClient?.close()
  })
  await import('./app/bootstrap.mjs')
} catch (error) {
  stop()
  process.stderr.write(`Gateway 启动失败：${error.message}\n`)
  process.exitCode = 1
}
