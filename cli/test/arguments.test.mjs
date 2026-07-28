import assert from 'node:assert/strict'
import test from 'node:test'
import { helpText, parseArguments } from '../src/arguments.mjs'

test('defaults to the Gateway command and managed OpenCode', () => {
  const options = parseArguments([], {})
  assert.equal(options.command, 'gateway')
  assert.equal(options.gatewayAction, 'run')
  assert.equal(options.url, 'http://127.0.0.1:3101')
  assert.equal(options.backend, 'opencode')
  assert.equal(options.backendMode, 'managed')
  assert.equal(options.backendPermissionMode, 'native')
  assert.equal(options.backendUrl, 'http://127.0.0.1:4096')
})

test('parses independent TUI and WebUI client commands', () => {
  const tui = parseArguments([
    'tui',
    '--url', 'https://voice.example.com/path',
    '--session', 'project-one',
    '--audio-mode', 'full',
  ], {})
  assert.equal(tui.command, 'tui')
  assert.equal(tui.url, 'https://voice.example.com')
  assert.equal(tui.sessionId, 'project-one')
  assert.equal(tui.audioMode, 'full')
  assert.equal(
    parseArguments(['tui'], {
      QWEN_AUDIO_AGENT_TUI_AUDIO_MODE: 'FULL',
    }).audioMode,
    'full',
  )

  const web = parseArguments(['webui', '--no-open', '--takeover'], {})
  assert.equal(web.command, 'webui')
  assert.equal(web.openBrowser, false)
  assert.equal(web.takeover, true)
})

test('parses Gateway backend ownership settings', () => {
  const options = parseArguments([
    'gateway',
    '--backend', 'openclaw',
    '--backend-mode', 'compatible',
    '--backend-agent', 'build',
    '--backend-url', 'http://localhost:18888/path',
  ], {})
  assert.equal(options.backend, 'openclaw')
  assert.equal(options.backendMode, 'compatible')
  assert.equal(options.backendAgent, 'build')
  assert.equal(options.backendUrl, 'http://localhost:18888')
})

test('accepts Qoder only as a managed backend without a URL', () => {
  const options = parseArguments([
    'gateway',
    '--backend', 'qoder',
  ], {})
  assert.equal(options.backend, 'qoder')
  assert.equal(options.backendMode, 'managed')
  assert.equal(options.backendUrl, '')
  assert.throws(
    () => parseArguments([
      'gateway',
      '--backend', 'qoder',
      '--backend-mode', 'compatible',
    ], {}),
    /只支持 managed/,
  )
})

test('accepts a generic ACP backend without an HTTP URL', () => {
  const options = parseArguments(['gateway', '--backend', 'acp'], {})
  assert.equal(options.backend, 'acp')
  assert.equal(options.backendMode, 'managed')
  assert.equal(options.backendUrl, '')
  assert.throws(() => parseArguments([
    'gateway',
    '--backend',
    'acp',
    '--backend-mode',
    'compatible',
  ], {}), /只支持 managed/)
})

test('parses supported backend permission modes', () => {
  const options = parseArguments([
    'gateway',
    '--backend', 'qoder',
    '--backend-permission-mode', 'full',
  ], {})
  assert.equal(options.backendPermissionMode, 'full')
  assert.throws(() => parseArguments([
    'gateway',
    '--backend', 'openclaw',
    '--backend-permission-mode', 'full',
  ], {}), /OpenClaw/)
  assert.throws(() => parseArguments([
    'gateway',
    '--backend-mode', 'compatible',
    '--backend-permission-mode', 'full',
  ], {}), /只支持由 Gateway 管理/)
})

test('parses foreground and service Gateway commands', () => {
  assert.equal(parseArguments(['gateway'], {}).gatewayAction, 'run')
  assert.equal(parseArguments(['gateway', 'run'], {}).gatewayAction, 'run')
  assert.equal(
    parseArguments(['gateway', 'install'], {}).gatewayAction,
    'install',
  )
  assert.equal(parseArguments(['gateway', 'start'], {}).gatewayAction, 'start')
  assert.equal(parseArguments(['gateway', 'stop'], {}).gatewayAction, 'stop')
  assert.equal(
    parseArguments(['gateway', 'restart'], {}).gatewayAction,
    'restart',
  )
  assert.equal(
    parseArguments(['gateway', 'uninstall'], {}).gatewayAction,
    'uninstall',
  )
  assert.equal(parseArguments(['status'], {}).gatewayAction, 'status')
})

test('rejects client-only flags on unrelated commands', () => {
  assert.throws(
    () => parseArguments(['tui', '--audio-mode', 'invalid'], {}),
    /不支持的音频模式/,
  )
  assert.throws(
    () => parseArguments(['webui', '--audio-mode', 'full'], {}),
    /只适用于 tui/,
  )
  assert.throws(
    () => parseArguments(['tui', '--no-open'], {}),
    /只适用于 webui/,
  )
  assert.throws(
    () => parseArguments(['status', '--takeover'], {}),
    /只适用于 tui 或 webui/,
  )
  assert.throws(
    () => parseArguments(['gateway', 'install', '--backend', 'openclaw'], {}),
    /config\.env/,
  )
})

test('documents the service and client commands', () => {
  const text = helpText()
  assert.match(text, /^qwenaudio$/m)
  assert.match(text, /qwenaudio \[gateway\]/)
  assert.match(text, /gateway install/)
  assert.match(text, /gateway uninstall/)
  assert.match(text, /qwenaudio tui/)
  assert.match(text, /qwenaudio webui/)
  assert.match(text, /qwenaudio status/)
  assert.match(text, /qwenaudio config/)
  assert.match(text, /managed/)
  assert.match(text, /--backend-permission-mode MODE/)
  assert.match(text, /--audio-mode MODE/)
  assert.match(text, /x\s+半双工模式下手动打断当前回复/)
  assert.doesNotMatch(text, /--mode/)
})
