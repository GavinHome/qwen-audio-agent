import { parseEnv } from 'node:util'

const DEFAULTS = {
  gatewayUrl: 'http://127.0.0.1:3101',
  realtimeProvider: 'dashscope',
  protocol: 'opencode',
  opencodeBaseUrl: 'http://127.0.0.1:4096',
  openclawBaseUrl: 'http://127.0.0.1:18789',
  realtimeModel: 'qwen-audio-3.0-realtime-plus',
  realtimeVoice: 'longanqian',
}

const SETTING_KEYS = {
  gatewayUrl: 'QWEN_AUDIO_AGENT_URL',
  apiKey: 'DASHSCOPE_API_KEY',
  realtimeProvider: 'QWEN_AUDIO_REALTIME_PROVIDER',
  protocol: 'AGENT_PROTOCOL',
  opencodeBaseUrl: 'OPENCODE_BASE_URL',
  openclawBaseUrl: 'OPENCLAW_BASE_URL',
  realtimeModel: 'QWEN_AUDIO_REALTIME_MODEL',
  realtimeVoice: 'QWEN_AUDIO_REALTIME_VOICE',
}

function cleanUrl(value, fallback, label = '地址') {
  const text = String(value || fallback).trim()
  const url = new URL(text)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label}只支持 HTTP 或 HTTPS`)
  }
  return url.origin
}

function encoded(value) {
  const text = String(value ?? '')
  if (/^[A-Za-z0-9_./:@+-]*$/.test(text)) return text
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function cleanModel(value) {
  const model = String(value || DEFAULTS.realtimeModel).trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) {
    throw new Error('实时模型名称格式无效')
  }
  return model
}

export function parseSettings(content = '', fallback = {}) {
  const values = parseEnv(content)
  const protocol = String(
    values.AGENT_PROTOCOL || fallback.AGENT_PROTOCOL || DEFAULTS.protocol,
  ).toLowerCase()
  return {
    gatewayUrl: values.QWEN_AUDIO_AGENT_URL
      || fallback.QWEN_AUDIO_AGENT_URL
      || DEFAULTS.gatewayUrl,
    apiKey: values.DASHSCOPE_API_KEY || fallback.DASHSCOPE_API_KEY || '',
    realtimeProvider: ['dashscope'].includes(
      String(
        values.QWEN_AUDIO_REALTIME_PROVIDER
        || fallback.QWEN_AUDIO_REALTIME_PROVIDER
        || '',
      ).toLowerCase(),
    ) ? String(
        values.QWEN_AUDIO_REALTIME_PROVIDER
        || fallback.QWEN_AUDIO_REALTIME_PROVIDER,
      ).toLowerCase() : DEFAULTS.realtimeProvider,
    protocol: ['opencode', 'openclaw'].includes(protocol)
      ? protocol
      : DEFAULTS.protocol,
    opencodeBaseUrl: values.OPENCODE_BASE_URL || fallback.OPENCODE_BASE_URL
      || DEFAULTS.opencodeBaseUrl,
    openclawBaseUrl: values.OPENCLAW_BASE_URL || fallback.OPENCLAW_BASE_URL
      || DEFAULTS.openclawBaseUrl,
    realtimeModel: values.QWEN_AUDIO_REALTIME_MODEL
      || fallback.QWEN_AUDIO_REALTIME_MODEL
      || DEFAULTS.realtimeModel,
    realtimeVoice: values.QWEN_AUDIO_REALTIME_VOICE
      || fallback.QWEN_AUDIO_REALTIME_VOICE
      || DEFAULTS.realtimeVoice,
  }
}

export function normalizeSettings(settings = {}) {
  const realtimeProvider = String(
    settings.realtimeProvider || DEFAULTS.realtimeProvider,
  ).toLowerCase()
  if (realtimeProvider !== 'dashscope') {
    throw new Error('当前版本只支持 DashScope Realtime')
  }
  const protocol = String(settings.protocol || DEFAULTS.protocol).toLowerCase()
  if (!['opencode', 'openclaw'].includes(protocol)) {
    throw new Error('后台 Agent 只能选择 OpenCode 或 OpenClaw')
  }
  return {
    gatewayUrl: cleanUrl(
      settings.gatewayUrl,
      DEFAULTS.gatewayUrl,
      'Gateway 地址',
    ),
    apiKey: String(settings.apiKey || '').trim(),
    realtimeProvider,
    protocol,
    opencodeBaseUrl: cleanUrl(
      settings.opencodeBaseUrl,
      DEFAULTS.opencodeBaseUrl,
    ),
    openclawBaseUrl: cleanUrl(
      settings.openclawBaseUrl,
      DEFAULTS.openclawBaseUrl,
    ),
    realtimeModel: cleanModel(settings.realtimeModel),
    realtimeVoice: String(
      settings.realtimeVoice || DEFAULTS.realtimeVoice,
    ).trim(),
  }
}

export function updateSettingsContent(content = '', settings = {}) {
  const normalized = normalizeSettings(settings)
  const values = Object.fromEntries(
    Object.entries(SETTING_KEYS).map(([field, key]) => [
      key,
      encoded(normalized[field]),
    ]),
  )
  const seen = new Set()
  const lines = content.split(/\r?\n/).map(line => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=/)
    const key = match?.[1]
    if (!key || !(key in values) || seen.has(key)) return line
    seen.add(key)
    return `${key}=${values[key]}`
  })
  for (const key of Object.values(SETTING_KEYS)) {
    if (!seen.has(key)) lines.push(`${key}=${values[key]}`)
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}
