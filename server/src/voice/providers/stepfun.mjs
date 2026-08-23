import { config, realtimeUrl } from '../../core/config.mjs'
import {
  listStepFunRealtimeModelProfiles,
  resolveStepFunRealtimeModelProfile,
} from '../../../../shared/realtime-provider-catalog.mjs'
import {
  buildFrontendInstructions,
  frontendTools,
  resultResponseInstructions,
  speakResponseInstructions,
  permissionResponseInstructions,
} from '../frontend-tools.mjs'
import { isRecoverableRealtimeInactivityError } from '../realtime-errors.mjs'
import { openAiCompatibleProtocol } from './openai-compatible-protocol.mjs'

function classifyError(message) {
  if (isRecoverableRealtimeInactivityError(message)) return 'inactivity'
  if (/user is speaking/i.test(message)) return 'input_busy'
  if (/no (?:active response|ongoing response)/i.test(message)) {
    return 'no_active_response'
  }
  if (
    /invalid[_ -]?api[_ -]?key|incorrect api key|authentication failed|unauthorized|unexpected server response: (?:401|403)/i
      .test(message)
    || /quota|insufficient balance|arrearage/i.test(message)
    || /model[_ -]?not[_ -]?found|permission denied/i.test(message)
  ) return 'fatal'
  return 'other'
}

function activeModelProfile() {
  return resolveStepFunRealtimeModelProfile(config.stepfunModel)
}

function responseModalities(profile) {
  const capabilities = profile.modelCapabilities
  return [
    capabilities.textOutput ? 'text' : null,
    capabilities.audioOutput ? 'audio' : null,
  ].filter(Boolean)
}

// StepFun Realtime（wss://api.stepfun.com/v1/realtime）采用 OpenAI Realtime
// 兼容事件流，step-audio-2 的原生 function_call 输出即标准形态，直接复用
// OpenAI 兼容协议适配层；会话使用与其他前台一致的完整指令与工具集。
export const stepfunProvider = {
  key: 'stepfun',
  label: 'StepFun StepAudio Realtime',
  aliases: ['stepaudio'],
  inputSampleRate: 16000,
  outputSampleRate: 24000,
  protocol: openAiCompatibleProtocol,

  get capabilities() {
    return {
      perResponseInstructions: true,
      conversationItemIdEcho: false,
    }
  },

  model: () => config.stepfunModel,
  modelCatalog: listStepFunRealtimeModelProfiles,
  modelProfile: activeModelProfile,
  voice: () => config.stepfunVoice || activeModelProfile().sessionDefaults.voice,
  isConfigured: () => Boolean(config.stepfunApiKey),
  missingConfigurationMessage: '请先配置 STEPFUN_API_KEY',
  connectTimeoutMessage: '连接 StepFun Realtime 超时',

  // StepFun 要求在 WebSocket URL 上携带 model 查询参数，否则握手被拒绝。
  url: () => realtimeUrl(config.stepfunRealtimeUrl, config.stepfunModel),
  headers: () => ({ Authorization: `Bearer ${config.stepfunApiKey}` }),
  classifyError,

  buildSession: ({ configured, agentContext }) => {
    const profile = activeModelProfile()
    const session = {
      instructions: buildFrontendInstructions(agentContext),
    }
    if (profile.modelCapabilities.functionCalling) {
      session.tools = frontendTools(agentContext)
    }
    if (!configured) {
      session.modalities = responseModalities(profile)
      if (profile.modelCapabilities.audioOutput) {
        const voice = stepfunProvider.voice()
        if (voice) session.voice = voice
        session.output_audio_format = 'pcm16'
      }
      if (profile.transportCapabilities.audioInput) {
        session.input_audio_format = 'pcm16'
      }
      session.turn_detection = profile.transportCapabilities.audioInput
        ? profile.sessionDefaults.turnDetection
        : null
    }
    return session
  },

  buildSpeakResponse: content => ({
    conversation: 'none',
    modalities: responseModalities(activeModelProfile()),
    instructions: speakResponseInstructions(content),
  }),

  buildResultInjection: content => ({
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: content }],
    },
    response: {
      modalities: responseModalities(activeModelProfile()),
      tool_choice: 'none',
      instructions: resultResponseInstructions,
    },
  }),

  buildPermissionInjection: permission => ({
    item: {
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: [
          '<backend_permission_request>',
          `authorization_id=${permission.id}`,
          `operation=${permission.summary}`,
          '</backend_permission_request>',
        ].join('\n'),
      }],
    },
    response: {
      modalities: responseModalities(activeModelProfile()),
      tool_choice: 'none',
      instructions: permissionResponseInstructions,
    },
  }),
}
