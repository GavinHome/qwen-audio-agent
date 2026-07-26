const form = document.querySelector('#settings-form')
const gatewayUrl = document.querySelector('#gateway-url')
const apiKey = document.querySelector('#api-key')
const realtimeProvider = document.querySelector('#realtime-provider')
const protocol = document.querySelector('#protocol')
const backendUrl = document.querySelector('#backend-url')
const backendModel = document.querySelector('#backend-model')
const realtimeModel = document.querySelector('#realtime-model')
const realtimeVoice = document.querySelector('#realtime-voice')
const message = document.querySelector('#message')
const currentRealtime = document.querySelector('#current-realtime')
const currentGateway = document.querySelector('#current-gateway')
const currentBackend = document.querySelector('#current-backend')
const submit = form.querySelector('button[type="submit"]')

let settings
let runtime
let draftUrls
let appliedFingerprint = ''
let applying = false

function selectedUrl() {
  return protocol.value === 'openclaw'
    ? draftUrls.openclawBaseUrl
    : draftUrls.opencodeBaseUrl
}

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
  return value === 'openclaw' ? 'OpenClaw' : 'OpenCode'
}

function formSettings() {
  return {
    ...settings,
    ...draftUrls,
    gatewayUrl: gatewayUrl.value,
    apiKey: apiKey.value,
    realtimeProvider: realtimeProvider.value,
    protocol: protocol.value,
    backendModel: backendModel.value,
    realtimeModel: realtimeModel.value,
    realtimeVoice: realtimeVoice.value,
  }
}

function fingerprint(value) {
  return JSON.stringify({
    gatewayUrl: value.gatewayUrl,
    apiKey: value.apiKey,
    realtimeProvider: value.realtimeProvider,
    protocol: value.protocol,
    backendModel: value.backendModel,
    realtimeModel: value.realtimeModel,
    realtimeVoice: value.realtimeVoice,
    opencodeBaseUrl: value.opencodeBaseUrl,
    openclawBaseUrl: value.openclawBaseUrl,
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
  } else {
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
    } else {
      const label = runtime.backend.label
        || backendLabel(runtime.backend.protocol)
      setBackendStatus(
        `${label} · ${runtime.backend.baseUrl}`,
        runtime.backend.connected,
      )
    }
  }
}

function render() {
  draftUrls = {
    opencodeBaseUrl: settings.opencodeBaseUrl,
    openclawBaseUrl: settings.openclawBaseUrl,
  }
  gatewayUrl.value = settings.gatewayUrl
  apiKey.value = settings.apiKey
  realtimeProvider.value = settings.realtimeProvider
  protocol.value = settings.protocol
  backendUrl.value = selectedUrl()
  backendModel.value = settings.backendModel
  realtimeModel.value = settings.realtimeModel
  realtimeVoice.value = settings.realtimeVoice
  renderRuntime()
  appliedFingerprint = fingerprint(formSettings())
  updateApplyState()
}

protocol.addEventListener('change', () => {
  backendUrl.value = selectedUrl()
  showMessage('')
  updateApplyState()
})

backendUrl.addEventListener('input', () => {
  if (protocol.value === 'openclaw') {
    draftUrls.openclawBaseUrl = backendUrl.value
  } else {
    draftUrls.opencodeBaseUrl = backendUrl.value
  }
  showMessage('')
  updateApplyState()
})

for (const control of [
  gatewayUrl,
  apiKey,
  realtimeProvider,
  backendModel,
  realtimeModel,
  realtimeVoice,
]) {
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
    showMessage(
      result.restartRequired
        ? '已保存；Gateway 配置将在下次启动时生效。'
        : '已应用。',
      result.restartRequired ? 'notice' : 'success',
    )
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
