import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'qwen-backend-runtime-'))
  const bin = resolve(directory, 'bin')
  const capture = resolve(directory, 'capture.txt')
  mkdirSync(bin)
  return {
    directory,
    bin,
    capture,
    close: () => rmSync(directory, { recursive: true, force: true }),
  }
}

function command(path, { version = '', captureModels = false } = {}) {
  writeFileSync(path, [
    '#!/bin/sh',
    ...(version ? [
      'if [ "${1:-}" = "--version" ]; then',
      `  printf "%s\\n" "${version}"`,
      '  exit 0',
      'fi',
    ] : []),
    'printf "%s\\n" "$(basename "$0")" "$@" > "$CAPTURE"',
    ...(captureModels ? [
      'printf "%s\\n" "OPENCODE_MODEL=${OPENCODE_MODEL:-}" >> "$CAPTURE"',
      'printf "%s\\n" "OPENCLAW_MODEL=${QWEN_AUDIO_AGENT_OPENCLAW_MODEL:-}" >> "$CAPTURE"',
      'printf "%s\\n" "OPENCLAW_MODEL_ID=${QWEN_AUDIO_AGENT_OPENCLAW_MODEL_ID:-}" >> "$CAPTURE"',
    ] : []),
    '',
  ].join('\n'))
  chmodSync(path, 0o755)
}

function run(script, target, env = {}, args = []) {
  const result = spawnSync(resolve(root, script), args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${target.bin}:/usr/bin:/bin`,
      CAPTURE: target.capture,
      QWEN_AUDIO_AGENT_ENV_LOADED: '1',
      QWEN_AUDIO_AGENT_NODE: process.execPath,
      QWAUDIO_CONFIG_DIR: resolve(target.directory, 'config'),
      ...env,
    },
  })
  assert.equal(result.status, 0, result.stderr)
  return readFileSync(target.capture, 'utf8').trim().split('\n')
}

test('OpenCode auto mode prefers the user-installed command', {
  skip: process.platform === 'win32',
}, () => {
  const target = fixture()
  try {
    command(resolve(target.bin, 'opencode'), { version: '1.20.0' })
    command(resolve(target.bin, 'npx'))
    assert.deepEqual(run('scripts/opencode-server', target, {
      OPENCODE_RUNTIME: 'auto',
      OPENCODE_PORT: '4321',
    }), [
      'opencode',
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      '4321',
    ])
  } finally {
    target.close()
  }
})

test('OpenCode auto mode skips an incompatible installed version', {
  skip: process.platform === 'win32',
}, () => {
  const target = fixture()
  try {
    command(resolve(target.bin, 'opencode'), { version: '1.1.53' })
    command(resolve(target.bin, 'npx'))
    assert.deepEqual(run('scripts/opencode-server', target, {
      OPENCODE_RUNTIME: 'auto',
      OPENCODE_PORT: '4321',
    }), [
      'npx',
      '--yes',
      'opencode-ai',
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      '4321',
    ])
  } finally {
    target.close()
  }
})

test('OpenClaw auto mode prefers the user-installed command', {
  skip: process.platform === 'win32',
}, () => {
  const target = fixture()
  try {
    command(resolve(target.bin, 'openclaw'))
    command(resolve(target.bin, 'npx'))
    assert.deepEqual(run('scripts/openclaw', target, {
      OPENCLAW_RUNTIME: 'auto',
    }, ['gateway', 'run']), [
      'openclaw',
      'gateway',
      'run',
    ])
    assert.match(
      readFileSync(
        resolve(target.directory, 'config/backends/openclaw/openclaw.json5'),
        'utf8',
      ),
      /QWEN_AUDIO_AGENT_OPENCLAW_WORKSPACE/,
    )
    assert.match(
      readFileSync(
        resolve(target.directory, 'config/workspaces/openclaw/AGENTS.md'),
        'utf8',
      ),
      /qwen-audio-agent/,
    )
  } finally {
    target.close()
  }
})

test('package mode uses unversioned configurable npm package names', {
  skip: process.platform === 'win32',
}, () => {
  const openCode = fixture()
  const openClaw = fixture()
  try {
    command(resolve(openCode.bin, 'npx'))
    command(resolve(openClaw.bin, 'npx'))
    assert.deepEqual(run('scripts/opencode-server', openCode, {
      OPENCODE_RUNTIME: 'package',
      OPENCODE_PORT: '4321',
    }), [
      'npx',
      '--yes',
      'opencode-ai',
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      '4321',
    ])
    assert.deepEqual(run('scripts/openclaw', openClaw, {
      OPENCLAW_RUNTIME: 'package',
    }, ['gateway', 'run']), [
      'npx',
      '--yes',
      'openclaw',
      'gateway',
      'run',
    ])
  } finally {
    openCode.close()
    openClaw.close()
  }
})

test('maps one common backend model into each native backend model', {
  skip: process.platform === 'win32',
}, () => {
  const openCode = fixture()
  const openClaw = fixture()
  try {
    command(resolve(openCode.bin, 'opencode'), {
      version: '1.20.0',
      captureModels: true,
    })
    command(resolve(openClaw.bin, 'openclaw'), { captureModels: true })
    assert.deepEqual(run('scripts/opencode-server', openCode, {
      QWEN_AUDIO_AGENT_BACKEND_MODEL: 'qwen-custom',
    }).slice(-3), [
      'OPENCODE_MODEL=alibaba-cn/qwen-custom',
      'OPENCLAW_MODEL=',
      'OPENCLAW_MODEL_ID=',
    ])
    assert.deepEqual(run('scripts/openclaw', openClaw, {
      QWEN_AUDIO_AGENT_BACKEND_MODEL: 'qwen-custom',
    }, ['gateway', 'run']).slice(-3), [
      'OPENCODE_MODEL=',
      'OPENCLAW_MODEL=bailian/qwen-custom',
      'OPENCLAW_MODEL_ID=qwen-custom',
    ])
  } finally {
    openCode.close()
    openClaw.close()
  }
})
