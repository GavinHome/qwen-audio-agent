export const DEFAULT_DASHSCOPE_REALTIME_MODEL = 'qwen-audio-3.0-realtime-plus'
export const DEFAULT_DASHSCOPE_REALTIME_VOICE = 'longanqian'

export const DASHSCOPE_AUDIO_FLASH_REALTIME_MODEL = 'qwen-audio-3.0-realtime-flash'
export const DASHSCOPE_OMNI_FLASH_REALTIME_MODEL = 'qwen3.5-omni-flash-realtime'
export const DASHSCOPE_OMNI_PLUS_REALTIME_MODEL = 'qwen3.5-omni-plus-realtime'

const OMNI_MODEL_CAPABILITIES = Object.freeze({
  textInput: true, audioInput: true, imageInput: true, videoInput: false,
  textOutput: true, audioOutput: true, functionCalling: true,
})
const OMNI_TRANSPORT_CAPABILITIES = Object.freeze({
  textInput: true, audioInput: true, imageInput: false,
  observationInput: false, nativeVideoInput: false,
})
const LEGACY_MODEL_CAPABILITIES = Object.freeze({
  textInput: true, audioInput: true, imageInput: false, videoInput: false,
  textOutput: true, audioOutput: true, functionCalling: true,
})
const LEGACY_TRANSPORT_CAPABILITIES = Object.freeze({
  textInput: true, audioInput: true, imageInput: false,
  observationInput: false, nativeVideoInput: false,
})
const UNKNOWN_MODEL_CAPABILITIES = Object.freeze({
  textInput: false, audioInput: false, imageInput: false, videoInput: false,
  textOutput: false, audioOutput: false, functionCalling: false,
})
const UNKNOWN_TRANSPORT_CAPABILITIES = Object.freeze({
  textInput: false, audioInput: false, imageInput: false,
  observationInput: false, nativeVideoInput: false,
})
const OMNI_SESSION_DEFAULTS = Object.freeze({
  voice: 'Ethan',
  turnDetection: Object.freeze({ type: 'semantic_vad' }),
})
const AUDIO_SESSION_DEFAULTS = Object.freeze({
  voice: DEFAULT_DASHSCOPE_REALTIME_VOICE,
  turnDetection: Object.freeze({ type: 'smart_turn' }),
})
const UNKNOWN_SESSION_DEFAULTS = Object.freeze({
  voice: null,
  turnDetection: null,
})

export const DASHSCOPE_REALTIME_MODEL_PROFILES = Object.freeze([
  Object.freeze({
    id: DASHSCOPE_OMNI_FLASH_REALTIME_MODEL,
    label: 'Qwen3.5 Omni Flash Realtime',
    family: 'omni',
    sessionDefaults: OMNI_SESSION_DEFAULTS,
    modelCapabilities: OMNI_MODEL_CAPABILITIES,
    transportCapabilities: OMNI_TRANSPORT_CAPABILITIES,
  }),
  Object.freeze({
    id: DASHSCOPE_OMNI_PLUS_REALTIME_MODEL,
    label: 'Qwen3.5 Omni Plus Realtime',
    family: 'omni',
    sessionDefaults: OMNI_SESSION_DEFAULTS,
    modelCapabilities: OMNI_MODEL_CAPABILITIES,
    transportCapabilities: OMNI_TRANSPORT_CAPABILITIES,
  }),
  Object.freeze({
    id: DEFAULT_DASHSCOPE_REALTIME_MODEL,
    label: 'Qwen Audio 3.0 Realtime Plus',
    family: 'audio',
    sessionDefaults: AUDIO_SESSION_DEFAULTS,
    modelCapabilities: LEGACY_MODEL_CAPABILITIES,
    transportCapabilities: LEGACY_TRANSPORT_CAPABILITIES,
  }),
  Object.freeze({
    id: DASHSCOPE_AUDIO_FLASH_REALTIME_MODEL,
    label: 'Qwen Audio 3.0 Realtime Flash',
    family: 'audio',
    sessionDefaults: AUDIO_SESSION_DEFAULTS,
    modelCapabilities: LEGACY_MODEL_CAPABILITIES,
    transportCapabilities: LEGACY_TRANSPORT_CAPABILITIES,
  }),
])

const PROFILES_BY_ID = new Map(
  DASHSCOPE_REALTIME_MODEL_PROFILES.map(profile => [profile.id, profile]),
)

export function listDashScopeRealtimeModelProfiles() {
  return DASHSCOPE_REALTIME_MODEL_PROFILES
}

export function resolveDashScopeRealtimeModelProfile(
  model = DEFAULT_DASHSCOPE_REALTIME_MODEL,
) {
  const id = String(model || '').trim() || DEFAULT_DASHSCOPE_REALTIME_MODEL
  return PROFILES_BY_ID.get(id) || Object.freeze({
    id,
    label: id,
    family: 'unknown',
    sessionDefaults: UNKNOWN_SESSION_DEFAULTS,
    modelCapabilities: UNKNOWN_MODEL_CAPABILITIES,
    transportCapabilities: UNKNOWN_TRANSPORT_CAPABILITIES,
  })
}

// StepFun 开放平台 Realtime（wss://api.stepfun.com/v1/realtime，按量计费）。
// step-audio-2 具备原生可靠 function calling；step-1o-audio 同样支持工具
// 调用，作为备用选项。stepaudio-2.5-realtime 定位情感陪伴，无可靠工具
// 调用能力，不在此列。
export const DEFAULT_STEPFUN_REALTIME_MODEL = 'step-audio-2'
export const DEFAULT_STEPFUN_REALTIME_VOICE = 'qingchunshaonv'

const STEPFUN_MODEL_CAPABILITIES = Object.freeze({
  textInput: true, audioInput: true, imageInput: false, videoInput: false,
  textOutput: true, audioOutput: true, functionCalling: true,
})
const STEPFUN_TRANSPORT_CAPABILITIES = Object.freeze({
  textInput: true, audioInput: true, imageInput: false,
  observationInput: false, nativeVideoInput: false,
})
const STEPFUN_SESSION_DEFAULTS = Object.freeze({
  voice: DEFAULT_STEPFUN_REALTIME_VOICE,
  turnDetection: Object.freeze({ type: 'server_vad' }),
})
// step-1o-audio 无公开预置音色列表，留空使用服务端默认音色。
const STEP_1O_SESSION_DEFAULTS = Object.freeze({
  voice: null,
  turnDetection: Object.freeze({ type: 'server_vad' }),
})

export const STEPFUN_REALTIME_MODEL_PROFILES = Object.freeze([
  Object.freeze({
    id: DEFAULT_STEPFUN_REALTIME_MODEL,
    label: 'Step Audio 2',
    family: 'stepaudio',
    sessionDefaults: STEPFUN_SESSION_DEFAULTS,
    modelCapabilities: STEPFUN_MODEL_CAPABILITIES,
    transportCapabilities: STEPFUN_TRANSPORT_CAPABILITIES,
  }),
  Object.freeze({
    id: 'step-1o-audio',
    label: 'Step 1o Audio',
    family: 'stepaudio',
    sessionDefaults: STEP_1O_SESSION_DEFAULTS,
    modelCapabilities: STEPFUN_MODEL_CAPABILITIES,
    transportCapabilities: STEPFUN_TRANSPORT_CAPABILITIES,
  }),
])

const STEPFUN_PROFILES_BY_ID = new Map(
  STEPFUN_REALTIME_MODEL_PROFILES.map(profile => [profile.id, profile]),
)

export function listStepFunRealtimeModelProfiles() {
  return STEPFUN_REALTIME_MODEL_PROFILES
}

export function resolveStepFunRealtimeModelProfile(
  model = DEFAULT_STEPFUN_REALTIME_MODEL,
) {
  const id = String(model || '').trim() || DEFAULT_STEPFUN_REALTIME_MODEL
  return STEPFUN_PROFILES_BY_ID.get(id) || Object.freeze({
    id,
    label: id,
    family: 'unknown',
    sessionDefaults: UNKNOWN_SESSION_DEFAULTS,
    modelCapabilities: UNKNOWN_MODEL_CAPABILITIES,
    transportCapabilities: UNKNOWN_TRANSPORT_CAPABILITIES,
  })
}
