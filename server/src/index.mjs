import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRuntimeEnvironment } from '../../shared/runtime-environment.mjs'
import { startManagedBackend } from './process/managed-backend.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
loadRuntimeEnvironment({ root })

let backendRuntime
let stopping = false

function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  backendRuntime?.close(signal)
}

try {
  backendRuntime = await startManagedBackend({ root })
  process.once('SIGINT', () => {
    stop('SIGINT')
    process.exit(0)
  })
  process.once('SIGTERM', () => {
    stop('SIGTERM')
    process.exit(0)
  })
  process.once('exit', () => stop())
  await import('./app/bootstrap.mjs')
} catch (error) {
  stop()
  process.stderr.write(`Gateway 启动失败：${error.message}\n`)
  process.exitCode = 1
}
