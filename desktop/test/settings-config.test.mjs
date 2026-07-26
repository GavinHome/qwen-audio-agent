import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseSettings,
  updateSettingsContent,
} from '../src/settings-config.mjs'

test('reads desktop settings with friendly defaults', () => {
  const settings = parseSettings('DASHSCOPE_API_KEY=test-key\n')
  assert.equal(settings.apiKey, 'test-key')
  assert.equal(settings.gatewayUrl, 'http://127.0.0.1:3101')
  assert.equal(settings.realtimeProvider, 'dashscope')
  assert.equal(settings.protocol, 'opencode')
  assert.equal(settings.opencodeBaseUrl, 'http://127.0.0.1:4096')
  assert.equal(settings.backendModel, 'qwen3.7-max')
  assert.equal(settings.realtimeModel, 'qwen-audio-3.0-realtime-plus')
})

test('shows effective project or process settings when user config is empty', () => {
  const settings = parseSettings('DASHSCOPE_API_KEY=\n', {
    DASHSCOPE_API_KEY: 'effective-key',
    AGENT_PROTOCOL: 'openclaw',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:19000',
    QWEN_AUDIO_AGENT_BACKEND_MODEL: 'qwen-custom',
    QWEN_AUDIO_REALTIME_MODEL: 'effective-model',
  })
  assert.equal(settings.apiKey, 'effective-key')
  assert.equal(settings.protocol, 'openclaw')
  assert.equal(settings.openclawBaseUrl, 'http://127.0.0.1:19000')
  assert.equal(settings.backendModel, 'qwen-custom')
  assert.equal(settings.realtimeModel, 'effective-model')
})

test('updates known settings while preserving advanced configuration', () => {
  const content = updateSettingsContent(
    '# local settings\nCUSTOM_SETTING=keep\nAGENT_PROTOCOL=opencode\n',
    {
      gatewayUrl: 'http://127.0.0.1:3200',
      apiKey: 'key value',
      realtimeProvider: 'dashscope',
      protocol: 'openclaw',
      opencodeBaseUrl: 'http://127.0.0.1:4096',
      openclawBaseUrl: 'http://127.0.0.1:18789',
      backendModel: 'qwen3.7-plus',
      realtimeModel: 'qwen-audio-realtime-custom',
      realtimeVoice: 'longanqian',
    },
  )
  assert.match(content, /CUSTOM_SETTING=keep/)
  assert.match(content, /QWEN_AUDIO_AGENT_URL=http:\/\/127\.0\.0\.1:3200/)
  assert.match(content, /AGENT_PROTOCOL=openclaw/)
  assert.match(content, /DASHSCOPE_API_KEY="key value"/)
  assert.match(content, /QWEN_AUDIO_REALTIME_PROVIDER=dashscope/)
  assert.match(content, /QWEN_AUDIO_AGENT_BACKEND_MODEL=qwen3.7-plus/)
  assert.match(content, /QWEN_AUDIO_REALTIME_MODEL=qwen-audio-realtime-custom/)
  assert.equal(parseSettings(content).protocol, 'openclaw')
  assert.equal(
    parseSettings(content).realtimeModel,
    'qwen-audio-realtime-custom',
  )
})

test('rejects invalid realtime model names', () => {
  assert.throws(() => updateSettingsContent('', {
    gatewayUrl: 'http://127.0.0.1:3101',
    protocol: 'opencode',
    realtimeProvider: 'dashscope',
    opencodeBaseUrl: 'http://127.0.0.1:4096',
    openclawBaseUrl: 'http://127.0.0.1:18789',
    backendModel: 'qwen3.7-max',
    realtimeModel: 'not a model',
    realtimeVoice: 'longanqian',
  }), /实时模型名称格式无效/)
})
