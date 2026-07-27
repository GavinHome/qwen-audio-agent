const form = document.querySelector('#settings-form')
const gatewayUrl = document.querySelector('#gateway-url')
const apiKey = document.querySelector('#api-key')
const realtimeProvider = document.querySelector('#realtime-provider')
const protocol = document.querySelector('#protocol')
const backendPermissionMode = document.querySelector('#backend-permission-mode')
const backendUrl = document.querySelector('#backend-url')
const backendModel = document.querySelector('#backend-model')
const realtimeModel = document.querySelector('#realtime-model')
const realtimeVoice = document.querySelector('#realtime-voice')
const orbStyle = document.querySelector('#orb-style')
const message = document.querySelector('#message')
const currentRealtime = document.querySelector('#current-realtime')
const currentGateway = document.querySelector('#current-gateway')
const currentBackend = document.querySelector('#current-backend')
const submit = form.querySelector('button[type="submit"]')
const fullPermissionOption = backendPermissionMode.querySelector(
  'option[value="full"]',
)

let settings
let runtime
let draftUrls
let draftModels
let appliedFingerprint = ''
let applying = false

function selectedUrl() {
  if (protocol.value === 'qoder') return ''
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
  if (value === 'openclaw') return 'OpenClaw'
  if (value === 'qoder') return 'Qoder'
  return 'OpenCode'
}

function updatePermissionAvailability() {
  const supported = protocol.value !== 'openclaw'
  fullPermissionOption.disabled = !supported
  if (!supported && backendPermissionMode.value === 'full') {
    backendPermissionMode.value = 'native'
  }
}

function formSettings() {
  return {
    ...settings,
    ...draftUrls,
    gatewayUrl: gatewayUrl.value,
    apiKey: apiKey.value,
    realtimeProvider: realtimeProvider.value,
    protocol: protocol.value,
    backendPermissionMode: backendPermissionMode.value,
    backendModel: protocol.value === 'qoder'
      ? draftModels.backendModel
      : backendModel.value,
    qoderModel: protocol.value === 'qoder'
      ? backendModel.value
      : draftModels.qoderModel,
    realtimeModel: realtimeModel.value,
    realtimeVoice: realtimeVoice.value,
    orbStyle: orbStyle.value,
  }
}

function fingerprint(value) {
  return JSON.stringify({
    gatewayUrl: value.gatewayUrl,
    apiKey: value.apiKey,
    realtimeProvider: value.realtimeProvider,
    protocol: value.protocol,
    backendPermissionMode: value.backendPermissionMode,
    backendModel: value.backendModel,
    qoderModel: value.qoderModel,
    realtimeModel: value.realtimeModel,
    realtimeVoice: value.realtimeVoice,
    orbStyle: value.orbStyle,
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
        runtime.backend.baseUrl
          ? `${label} · ${runtime.backend.baseUrl}`
          : label,
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
  draftModels = {
    backendModel: settings.backendModel,
    qoderModel: settings.qoderModel,
  }
  gatewayUrl.value = settings.gatewayUrl
  apiKey.value = settings.apiKey
  realtimeProvider.value = settings.realtimeProvider
  protocol.value = settings.protocol
  backendPermissionMode.value = settings.backendPermissionMode
  updatePermissionAvailability()
  backendUrl.value = selectedUrl()
  backendModel.value = settings.protocol === 'qoder'
    ? settings.qoderModel
    : settings.backendModel
  backendUrl.disabled = settings.protocol === 'qoder'
  backendUrl.required = settings.protocol !== 'qoder'
  realtimeModel.value = settings.realtimeModel
  realtimeVoice.value = settings.realtimeVoice
  orbStyle.value = settings.orbStyle
  renderRuntime()
  appliedFingerprint = fingerprint(formSettings())
  updateApplyState()
}

protocol.addEventListener('change', () => {
  const previousProtocol = settings.protocol
  if (previousProtocol === 'qoder') {
    draftModels.qoderModel = backendModel.value
  } else {
    draftModels.backendModel = backendModel.value
  }
  settings.protocol = protocol.value
  updatePermissionAvailability()
  backendUrl.value = selectedUrl()
  backendUrl.disabled = protocol.value === 'qoder'
  backendUrl.required = protocol.value !== 'qoder'
  backendModel.value = protocol.value === 'qoder'
    ? draftModels.qoderModel
    : draftModels.backendModel
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
  backendPermissionMode,
  backendModel,
  realtimeModel,
  realtimeVoice,
  orbStyle,
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
