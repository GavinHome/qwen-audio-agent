const form = document.querySelector('#settings-form')
const gatewayUrl = document.querySelector('#gateway-url')
const orbStyle = document.querySelector('#orb-style')
const message = document.querySelector('#message')
const currentRealtime = document.querySelector('#current-realtime')
const currentGateway = document.querySelector('#current-gateway')
const currentBackend = document.querySelector('#current-backend')
const submit = form.querySelector('button[type="submit"]')

let settings
let runtime
let appliedFingerprint = ''
let applying = false

function showMessage(text, kind = '') {
  message.textContent = text
  message.className = kind
}

function friendlyError(error, fallback) {
  return String(error?.message || fallback).replace(
    /^Error invoking remote method '[^']+': Error:\s*/,
    '',
  )
}

function backendLabel(value) {
  if (value === 'openclaw') return 'OpenClaw'
  if (value === 'qoder') return 'Qoder'
  return 'OpenCode'
}

function formSettings() {
  return {
    gatewayUrl: gatewayUrl.value,
    orbStyle: orbStyle.value,
  }
}

function fingerprint(value) {
  return JSON.stringify({
    gatewayUrl: value.gatewayUrl,
    orbStyle: value.orbStyle,
  })
}

function updateApplyState() {
  submit.disabled = applying || fingerprint(formSettings()) === appliedFingerprint
}

function setBackendStatus(text, connected) {
  currentBackend.textContent = text
  currentBackend.className = `connection-status ${connected ? 'connected' : 'disconnected'}`
}

function renderRuntime() {
  if (!runtime?.gatewayConnected) {
    currentGateway.textContent = '未连接'
    currentGateway.className = 'connection-status disconnected'
    currentRealtime.textContent = 'Gateway 未连接'
    setBackendStatus('未连接', false)
    return
  }

  currentGateway.textContent = '已连接'
  currentGateway.className = 'connection-status connected'
  const provider = runtime.realtimeProvider === 'dashscope'
    ? 'DashScope'
    : runtime.realtimeProvider || '未知'
  currentRealtime.textContent = runtime.voiceConfigured
    ? `${provider} · ${runtime.realtimeModel || '默认模型'}`
    : `${provider} · 缺少凭据`
  if (!runtime.backend) {
    setBackendStatus('未配置', false)
    return
  }
  const label = runtime.backend.label
    || backendLabel(runtime.backend.protocol)
  setBackendStatus(
    runtime.backend.baseUrl
      ? `${label} · ${runtime.backend.baseUrl}`
      : label,
    runtime.backend.connected,
  )
}

function render() {
  gatewayUrl.value = settings.gatewayUrl
  orbStyle.value = settings.orbStyle
  renderRuntime()
  appliedFingerprint = fingerprint(formSettings())
  updateApplyState()
}

for (const control of [gatewayUrl, orbStyle]) {
  control.addEventListener('input', () => {
    showMessage('')
    updateApplyState()
  })
  control.addEventListener('change', () => {
    showMessage('')
    updateApplyState()
  })
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  applying = true
  updateApplyState()
  showMessage('正在连接 Gateway…')
  try {
    const result = await window.qwenAudioAgentDesktop.saveSettings(formSettings())
    settings = result.settings
    runtime = result.runtime
    render()
    showMessage('已应用。', 'success')
  } catch (error) {
    showMessage(friendlyError(error, '应用失败'), 'error')
  } finally {
    applying = false
    updateApplyState()
  }
})

window.qwenAudioAgentDesktop.loadSettings().then(value => {
  settings = value.settings
  runtime = value.runtime
  render()
}).catch(error => {
  showMessage(friendlyError(error, '读取设置失败'), 'error')
  submit.disabled = true
})
