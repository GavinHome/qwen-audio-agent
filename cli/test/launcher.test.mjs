import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { main } from '../src/launcher.mjs'

function harness({ ownsProcesses = false } = {}) {
  const calls = []
  const runtime = {
    ownsProcesses,
    close: signal => calls.push(['runtime.close', signal]),
    wait: async () => 17,
  }
  return {
    calls,
    dependencies: {
      env: {},
      stdout: { write: value => calls.push(['stdout', value]) },
      signalSource: new EventEmitter(),
      prepareEnvironment: () => ({
        configDirectory: '/home/user/.config/qwaudio',
        configPath: '/home/user/.config/qwaudio/config.env',
      }),
      acquireInstance: () => ({
        release: () => calls.push(['instance.release']),
      }),
      prepareRuntime: async options => {
        calls.push(['runtime', options])
        return runtime
      },
      inspectGateway: async () => ({
        backend: { kind: 'opencode', ok: true },
      }),
      manageService: async action => {
        calls.push(['service', action])
        return {
          installed: true,
          running: action !== 'stop' && action !== 'uninstall',
          logPath: '/home/user/.config/qwaudio/logs/gateway.log',
        }
      },
      waitForService: async url => {
        calls.push(['service.ready', url])
        return { backend: { kind: 'opencode', ok: true } }
      },
      waitForServiceStop: async url => {
        calls.push(['service.stopped', url])
      },
      runMinimalTui: async options => {
        calls.push(['minimal', options])
        return 11
      },
      runWebUi: async options => {
        calls.push(['webui', options])
        return 13
      },
    },
  }
}

test('starts the Gateway by default without acquiring a UI lock', async () => {
  const target = harness()
  assert.equal(await main([], target.dependencies), 0)
  assert.deepEqual(target.calls.map(call => call[0]), [
    'runtime',
    'stdout',
  ])
})

test('keeps an owned Gateway in the foreground', async () => {
  const target = harness({ ownsProcesses: true })
  assert.equal(await main(['gateway'], target.dependencies), 17)
  assert.deepEqual(
    target.calls.filter(call => call[0] === 'runtime.close').at(-1),
    ['runtime.close', undefined],
  )
})

test('installs, stops and reports the background Gateway service', async () => {
  const install = harness()
  assert.equal(
    await main(['gateway', 'install'], install.dependencies),
    0,
  )
  assert.deepEqual(install.calls.map(call => call[0]), [
    'service',
    'service',
    'service.ready',
    'stdout',
    'stdout',
  ])

  const stop = harness()
  assert.equal(await main(['gateway', 'stop'], stop.dependencies), 0)
  assert.deepEqual(stop.calls.map(call => call[0]), [
    'service',
    'service',
    'service.stopped',
    'stdout',
    'stdout',
  ])

  const status = harness()
  assert.equal(await main(['gateway', 'status'], status.dependencies), 0)
  assert.deepEqual(status.calls.map(call => call[0]), [
    'service',
    'stdout',
  ])
})

test('does not confuse a foreground Gateway with the background service', async () => {
  const restart = harness()
  restart.dependencies.manageService = async action => {
    restart.calls.push(['service', action])
    return { installed: true, running: false }
  }
  await assert.rejects(
    main(['gateway', 'restart'], restart.dependencies),
    /正在前台运行/,
  )
  assert.deepEqual(restart.calls.map(call => call[0]), ['service'])

  const uninstall = harness()
  uninstall.dependencies.manageService = async action => {
    uninstall.calls.push(['service', action])
    return {
      installed: action !== 'uninstall',
      running: false,
    }
  }
  assert.equal(
    await main(['gateway', 'uninstall'], uninstall.dependencies),
    0,
  )
  assert.equal(
    uninstall.calls.some(call => call[0] === 'service.stopped'),
    false,
  )
})

test('connects TUI and WebUI without starting services', async () => {
  const tui = harness()
  assert.equal(
    await main(['tui', '--audio-mode', 'full'], tui.dependencies),
    11,
  )
  assert.deepEqual(tui.calls.map(call => call[0]), [
    'minimal',
    'instance.release',
  ])
  assert.equal(tui.calls[0][1].audioMode, 'full')

  const web = harness()
  assert.equal(await main(['webui'], web.dependencies), 13)
  assert.deepEqual(web.calls.map(call => call[0]), ['webui'])
})

test('requires a running Gateway for client commands', async () => {
  const target = harness()
  target.dependencies.inspectGateway = async () => null
  await assert.rejects(main(['tui'], target.dependencies), /请先执行/)
  assert.deepEqual(target.calls, [])
})

test('prints status and configuration without starting a service', async () => {
  const status = harness()
  assert.equal(await main(['status'], status.dependencies), 0)
  assert.deepEqual(status.calls.map(call => call[0]), ['service', 'stdout'])

  const config = harness()
  assert.equal(await main(['config'], config.dependencies), 0)
  assert.deepEqual(config.calls, [[
    'stdout',
    '/home/user/.config/qwaudio/config.env\n',
  ]])
})
