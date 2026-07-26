#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmExecutable = process.env.npm_execpath
const command = npmExecutable ? process.execPath : (
  process.platform === 'win32' ? 'npm.cmd' : 'npm'
)
const args = [
  ...(npmExecutable ? [npmExecutable] : []),
  'pack',
  '--dry-run',
  '--json',
  '--ignore-scripts',
]
const result = spawnSync(command, args, {
  cwd: root,
  env: process.env,
  encoding: 'utf8',
})
if (result.error) throw result.error
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  throw new Error('npm pack 自检失败')
}

const packages = JSON.parse(result.stdout)
if (packages.length !== 1) throw new Error('npm pack 返回了意外的包数量')
const files = new Set(packages[0].files.map(file => file.path))
const required = [
  'cli/bin/qwenaudio.mjs',
  'config/openclaw.json5',
  'config/opencode/agents/qwen-audio-agent-backend.md',
  'config/opencode/plugin/qwen-audio-agent-sessions.js',
  'scripts/backend',
  'scripts/install-global.mjs',
  'server/src/index.mjs',
  'shared/runtime-environment.mjs',
  'tui/src/index.mjs',
  'web/dist/index.html',
]
const missing = required.filter(file => !files.has(file))
if (missing.length) {
  throw new Error(`npm 成品缺少必要文件：${missing.join(', ')}`)
}
const forbidden = [...files].filter(file => (
  file.includes('/__pycache__/')
  || file.endsWith('.pyc')
  || file.includes('/node_modules/')
))
if (forbidden.length) {
  throw new Error(`npm 成品包含不应发布的文件：${forbidden.join(', ')}`)
}

process.stdout.write(
  `npm 成品自检通过：${packages[0].filename}，共 ${files.size} 个文件。\n`,
)
