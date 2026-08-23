import assert from 'node:assert/strict'
import test from 'node:test'
import { config } from '../src/core/config.mjs'
import {
  describeActiveRealtime,
  REALTIME_PROVIDERS,
} from '../src/voice/realtime-provider.mjs'
import {
  DEFAULT_STEPFUN_REALTIME_MODEL,
  DEFAULT_STEPFUN_REALTIME_URL,
  resolveStepFunRealtimeModelProfile,
} from '../../shared/realtime-provider-catalog.mjs'

const stepfun = REALTIME_PROVIDERS.stepfun

function withStepFunConfig(t, { model = '', voice = '' } = {}) {
  const originalModel = config.stepfunModel
  const originalVoice = config.stepfunVoice
  config.stepfunModel = model
  config.stepfunVoice = voice
  t.after(() => {
    config.stepfunModel = originalModel
    config.stepfunVoice = originalVoice
  })
}

test('builds a StepFun session with the standard frontend contract', t => {
  withStepFunConfig(t)
  const session = stepfun.buildSession({
    configured: false,
    agentContext: { client: { timeZone: 'Asia/Shanghai', locale: 'zh-CN' } },
  })

  assert.deepEqual(session.modalities, ['text', 'audio'])
  assert.deepEqual(session.turn_detection, { type: 'server_vad' })
  assert.equal(session.input_audio_format, 'pcm16')
  assert.equal(session.output_audio_format, 'pcm16')
  assert.equal(session.voice, 'qingchunshaonv')
  // 与 DashScope 前台完全一致的标准指令与全量工具，无任何裁剪或别名。
  assert.equal(session.instructions, stepfun.buildSession({
    configured: false,
    agentContext: { client: { timeZone: 'Asia/Shanghai', locale: 'zh-CN' } },
  }).instructions)
  assert.deepEqual(
    session.tools.map(tool => tool.function.name),
    [
      'spawn_thinking',
      'schedule_reminder',
      'cancel_agent_task',
      'get_agent_task_status',
      'get_current_time',
      'memory',
      'notes',
      'respond_agent_permission',
    ],
  )
  assert.equal(stepfun.inputSampleRate, 16000)
  assert.equal(stepfun.outputSampleRate, 24000)
})

test('carries the model in the StepFun realtime URL query', t => {
  withStepFunConfig(t, { model: DEFAULT_STEPFUN_REALTIME_MODEL })
  assert.equal(
    stepfun.url(),
    `${DEFAULT_STEPFUN_REALTIME_URL}?model=${DEFAULT_STEPFUN_REALTIME_MODEL}`,
  )
})

test('resolves StepFun model profiles and their session defaults', () => {
  const primary = resolveStepFunRealtimeModelProfile(DEFAULT_STEPFUN_REALTIME_MODEL)
  assert.equal(primary.label, 'Step Audio 2')
  assert.equal(primary.family, 'stepaudio')
  assert.equal(primary.modelCapabilities.functionCalling, true)
  assert.deepEqual(primary.sessionDefaults.turnDetection, { type: 'server_vad' })

  const backup = resolveStepFunRealtimeModelProfile('step-1o-audio')
  assert.equal(backup.label, 'Step 1o Audio')
  // step-1o-audio 无公开预置音色列表，留空时不下发 voice 字段。
  assert.equal(backup.sessionDefaults.voice, null)
})

test('omits the session voice when the resolved profile has none', t => {
  withStepFunConfig(t, { model: 'step-1o-audio' })
  const session = stepfun.buildSession({ configured: false })
  assert.equal('voice' in session, false)
})

test('prefers the configured voice over the profile default', t => {
  withStepFunConfig(t, {
    model: DEFAULT_STEPFUN_REALTIME_MODEL,
    voice: 'cloned-voice-id',
  })
  assert.equal(
    stepfun.buildSession({ configured: false }).voice,
    'cloned-voice-id',
  )
})

test('fails closed for an unknown StepFun model', () => {
  const profile = resolveStepFunRealtimeModelProfile('stepaudio-9-realtime')
  assert.equal(profile.family, 'unknown')
  assert.deepEqual(Object.values(profile.modelCapabilities), Array(7).fill(false))
})

test('classifies StepFun realtime errors', () => {
  for (const [message, expected] of [
    ['invalid api key', 'fatal'],
    ['Unexpected server response: 401', 'fatal'],
    ['Insufficient balance', 'fatal'],
    ['model not found: step-audio-2', 'fatal'],
    ['permission denied', 'fatal'],
    ['Cannot create response while user is speaking.', 'input_busy'],
    ['no ongoing response to cancel', 'no_active_response'],
    ['No active response to cancel', 'no_active_response'],
    ['voice tongxue is not valid', 'other'],
  ]) {
    assert.equal(stepfun.classifyError(message), expected, message)
  }
})

test('exposes the StepFun capabilities and response builders', t => {
  withStepFunConfig(t)
  assert.deepEqual(stepfun.capabilities, {
    perResponseInstructions: true,
    conversationItemIdEcho: false,
  })
  assert.equal(stepfun.isConfigured(), Boolean(config.stepfunApiKey))
  assert.equal(stepfun.missingConfigurationMessage, '请先配置 STEPFUN_API_KEY')

  const speak = stepfun.buildSpeakResponse('完成')
  assert.equal(speak.conversation, 'none')
  assert.deepEqual(speak.modalities, ['text', 'audio'])

  const result = stepfun.buildResultInjection('结果到达')
  assert.equal(result.item.role, 'user')
  assert.equal(result.response.tool_choice, 'none')
  assert.match(result.response.instructions, /结合当前对话自然回应/)

  const permission = stepfun.buildPermissionInjection({
    id: 'auth-1',
    summary: '读取文件',
  })
  assert.match(permission.item.content[0].text, /<backend_permission_request>/)
  assert.equal(permission.response.tool_choice, 'none')
  assert.match(permission.response.instructions, /是否同意授权/)
})

test('publishes the StepFun provider in the realtime catalog', t => {
  const originalApiKey = config.stepfunApiKey
  config.stepfunApiKey = 'configured-for-catalog-test'
  withStepFunConfig(t)
  t.after(() => {
    config.stepfunApiKey = originalApiKey
  })

  const active = describeActiveRealtime('stepfun')

  assert.equal(active.provider, 'stepfun')
  assert.equal(active.label, 'StepFun StepAudio Realtime')
  assert.equal(active.modelProfile.id, DEFAULT_STEPFUN_REALTIME_MODEL)
  assert.deepEqual(
    active.modelCatalog.map(profile => profile.id),
    ['step-audio-2', 'step-1o-audio'],
  )
  assert.ok(
    active.providers.some(provider => provider.key === 'stepfun'),
  )
})
