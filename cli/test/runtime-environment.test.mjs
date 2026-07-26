import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  loadRuntimeEnvironment,
  requireDashScopeCredential,
  userConfigDirectory,
} from '../../shared/runtime-environment.mjs'

function fixture() {
  const base = mkdtempSync(resolve(tmpdir(), 'qwaudio-config-'))
  const root = resolve(base, 'app')
  const homeDirectory = resolve(base, 'home')
  mkdirSync(root, { recursive: true })
  mkdirSync(homeDirectory, { recursive: true })
  for (const backend of ['opencode', 'openclaw']) {
    const workspace = resolve(root, `config/${backend}-workspace`)
    mkdirSync(workspace, { recursive: true })
    writeFileSync(resolve(workspace, 'AGENTS.md'), `# ${backend}\n`)
  }
  return { base, root, homeDirectory }
}

test('loads environment, project and user config in documented priority order', () => {
  const target = fixture()
  const configDirectory = resolve(target.homeDirectory, '.config/qwaudio')
  mkdirSync(configDirectory, { recursive: true })
  writeFileSync(resolve(configDirectory, 'config.env'), [
    'DASHSCOPE_API_KEY=user-key',
    'AGENT_PROTOCOL=openclaw',
  ].join('\n'))
  writeFileSync(resolve(target.root, '.env'), [
    'DASHSCOPE_API_KEY=project-key',
    'OPENCODE_BASE_URL=http://127.0.0.1:5000',
  ].join('\n'))
  const env = { DASHSCOPE_API_KEY: 'process-key' }

  loadRuntimeEnvironment({
    root: target.root,
    homeDirectory: target.homeDirectory,
    env,
  })

  assert.equal(env.DASHSCOPE_API_KEY, 'process-key')
  assert.equal(env.OPENCODE_BASE_URL, 'http://127.0.0.1:5000')
  assert.equal(env.AGENT_PROTOCOL, 'openclaw')
})

test('generates and reuses a private stable local identity secret', () => {
  const target = fixture()
  const first = {}
  const result = loadRuntimeEnvironment({
    root: target.root,
    homeDirectory: target.homeDirectory,
    env: first,
  })
  assert.equal(result.generatedSecret, true)
  assert.equal(first.QWEN_AUDIO_AGENT_AUTH_SECRET.length, 64)
  assert.equal(statSync(result.statePath).mode & 0o777, 0o600)

  const second = {}
  loadRuntimeEnvironment({
    root: target.root,
    homeDirectory: target.homeDirectory,
    env: second,
  })
  assert.equal(
    second.QWEN_AUDIO_AGENT_AUTH_SECRET,
    first.QWEN_AUDIO_AGENT_AUTH_SECRET,
  )
  assert.match(readFileSync(result.statePath, 'utf8'), /AUTH_SECRET=/)
  assert.match(readFileSync(result.configPath, 'utf8'), /DASHSCOPE_API_KEY=/)
  assert.equal(statSync(result.configPath).mode & 0o777, 0o600)
  assert.match(readFileSync(result.userProfilePath, 'utf8'), /^# USER/m)
  assert.equal(statSync(result.userProfilePath).mode & 0o777, 0o600)
})

test('does not overwrite an existing user profile', () => {
  const target = fixture()
  const configDirectory = resolve(target.homeDirectory, '.config/qwaudio')
  mkdirSync(configDirectory, { recursive: true })
  const profilePath = resolve(configDirectory, 'USER.md')
  writeFileSync(profilePath, '# USER\n\n- 称呼：老大\n')

  const result = loadRuntimeEnvironment({
    root: target.root,
    homeDirectory: target.homeDirectory,
    env: {},
    generateSecret: false,
  })

  assert.equal(result.userProfilePath, profilePath)
  assert.equal(readFileSync(profilePath, 'utf8'), '# USER\n\n- 称呼：老大\n')
  assert.equal(statSync(profilePath).mode & 0o777, 0o600)
})

test('supports an explicit cross-platform user config directory', () => {
  assert.equal(
    userConfigDirectory({
      QWAUDIO_CONFIG_DIR: '/tmp/qwaudio-custom',
    }, '/unused'),
    '/tmp/qwaudio-custom',
  )
})

test('keeps managed backend data outside the installation directory', () => {
  const target = fixture()
  const env = {}
  const result = loadRuntimeEnvironment({
    root: target.root,
    homeDirectory: target.homeDirectory,
    env,
    generateSecret: false,
  })

  assert.equal(
    result.openCodeWorkspace,
    resolve(result.configDirectory, 'workspaces/opencode'),
  )
  assert.equal(
    result.openClawWorkspace,
    resolve(result.configDirectory, 'workspaces/openclaw'),
  )
  assert.equal(
    result.openClawStateDirectory,
    resolve(result.configDirectory, 'backends/openclaw/state'),
  )
  assert.equal(env.OPENCODE_WORKSPACE, result.openCodeWorkspace)
  assert.equal(
    env.QWEN_AUDIO_AGENT_OPENCLAW_WORKSPACE,
    result.openClawWorkspace,
  )
  assert.equal(env.OPENCLAW_STATE_DIR, result.openClawStateDirectory)
  assert.match(
    readFileSync(resolve(result.openCodeWorkspace, 'AGENTS.md'), 'utf8'),
    /opencode/,
  )
})

test('migrates private runtime data into the user config directory', () => {
  const target = fixture()
  const legacyDirectory = resolve(target.root, 'runtime')
  mkdirSync(legacyDirectory, { recursive: true })
  const legacyMemory = resolve(legacyDirectory, 'frontend-memory.json')
  const legacyTasks = resolve(legacyDirectory, 'tasks.json')
  writeFileSync(legacyMemory, '{\"memory\":true}')
  writeFileSync(legacyTasks, '{\"tasks\":true}')

  const result = loadRuntimeEnvironment({
    root: target.root,
    homeDirectory: target.homeDirectory,
    env: {},
    generateSecret: false,
  })

  assert.equal(
    result.frontendMemoryPath,
    resolve(result.configDirectory, 'frontend-memory.json'),
  )
  assert.equal(
    result.taskStatePath,
    resolve(result.configDirectory, 'tasks.json'),
  )
  assert.equal(readFileSync(result.frontendMemoryPath, 'utf8'), '{\"memory\":true}')
  assert.equal(readFileSync(result.taskStatePath, 'utf8'), '{\"tasks\":true}')
  assert.equal(statSync(result.frontendMemoryPath).mode & 0o777, 0o600)
  assert.equal(statSync(result.taskStatePath).mode & 0o777, 0o600)
  assert.equal(existsSync(legacyMemory), false)
  assert.equal(existsSync(legacyTasks), false)
  assert.deepEqual(result.migratedFiles, [
    result.frontendMemoryPath,
    result.taskStatePath,
  ])
})

test('requires only a DashScope credential from the user', () => {
  assert.doesNotThrow(() => requireDashScopeCredential({
    DASHSCOPE_API_KEY: 'key',
  }))
  assert.throws(() => requireDashScopeCredential({}), /DASHSCOPE_API_KEY/)
})
