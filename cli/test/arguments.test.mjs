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
  assert.equal(options.backendUrl, 'http://127.0.0.1:4096')
})

test('parses independent TUI and WebUI client commands', () => {
  const tui = parseArguments([
    'tui',
    '--url', 'https://voice.example.com/path',
    '--session', 'project-one',
  ], {})
  assert.equal(tui.command, 'tui')
  assert.equal(tui.url, 'https://voice.example.com')
  assert.equal(tui.sessionId, 'project-one')

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
    () => parseArguments(['tui', '--mode', 'full'], {}),
    /未知参数：--mode/,
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
  assert.match(text, /x\s+手动打断当前回复（仅 Linux \/ Windows）/)
  assert.doesNotMatch(text, /--mode|full/)
})
