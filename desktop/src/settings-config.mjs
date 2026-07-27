import { parseEnv } from 'node:util'

const DEFAULTS = {
  gatewayUrl: 'http://127.0.0.1:3101',
  orbStyle: 'fluid',
}

const SETTING_KEYS = {
  gatewayUrl: 'QWEN_AUDIO_AGENT_URL',
  orbStyle: 'QWEN_AUDIO_ORB_STYLE',
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

export function parseSettings(content = '', fallback = {}) {
  const values = parseEnv(content)
  return {
    gatewayUrl: values.QWEN_AUDIO_AGENT_URL
      || fallback.QWEN_AUDIO_AGENT_URL
      || DEFAULTS.gatewayUrl,
    orbStyle: ['fluid', 'goo'].includes(
      String(
        values.QWEN_AUDIO_ORB_STYLE
        || fallback.QWEN_AUDIO_ORB_STYLE
        || '',
      ).toLowerCase(),
    ) ? String(
        values.QWEN_AUDIO_ORB_STYLE
        || fallback.QWEN_AUDIO_ORB_STYLE,
      ).toLowerCase() : DEFAULTS.orbStyle,
  }
}

export function normalizeSettings(settings = {}) {
  return {
    gatewayUrl: cleanUrl(
      settings.gatewayUrl,
      DEFAULTS.gatewayUrl,
      'Gateway 地址',
    ),
    orbStyle: ['fluid', 'goo'].includes(
      String(settings.orbStyle || DEFAULTS.orbStyle).toLowerCase(),
    )
      ? String(settings.orbStyle || DEFAULTS.orbStyle).toLowerCase()
      : DEFAULTS.orbStyle,
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
