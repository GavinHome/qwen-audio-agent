import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { loadRuntimeEnvironment } from '../../../shared/runtime-environment.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const runtimeEnvironment = loadRuntimeEnvironment({ root })

function numberSetting(value, fallback, {
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
} = {}) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export function resolveOpenCodeWorkspace(
  env = process.env,
  configDirectory = runtimeEnvironment.configDirectory,
) {
  return env.OPENCODE_WORKSPACE
    ? resolve(root, env.OPENCODE_WORKSPACE)
    : resolve(configDirectory, 'workspaces/opencode')
}

export function resolveQoderWorkspace(
  env = process.env,
  configDirectory = runtimeEnvironment.configDirectory,
) {
  return env.QODER_WORKSPACE
    ? resolve(root, env.QODER_WORKSPACE)
    : resolve(configDirectory, 'workspaces/qoder')
}

const DEFAULT_BACKEND_MODEL = 'qwen3.7-max'

function backendModelName(value) {
  const model = String(value || DEFAULT_BACKEND_MODEL).trim()
  const separator = model.indexOf('/')
  return separator >= 0 ? model.slice(separator + 1) : model
}

export function resolveBackendModels(env = process.env) {
  const common = String(
    env.QWEN_AUDIO_AGENT_BACKEND_MODEL || DEFAULT_BACKEND_MODEL,
  ).trim() || DEFAULT_BACKEND_MODEL
  return {
    common,
    openCode: String(
      env.OPENCODE_MODEL
      || `alibaba-cn/${backendModelName(common)}`,
    ).trim(),
    openClaw: String(
      env.OPENCLAW_MODEL
      || `bailian/${backendModelName(common)}`,
    ).trim(),
  }
}

const backendMode = (
  String(process.env.QWEN_AUDIO_AGENT_BACKEND_MODE || 'managed').toLowerCase()
  === 'compatible'
    ? 'compatible'
    : 'managed'
)
const backendModels = resolveBackendModels()
const backendPermissionMode = String(
  process.env.QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE || 'native',
).toLowerCase()
if (!['native', 'full'].includes(backendPermissionMode)) {
  throw new Error(
    `不支持的后台权限模式：${backendPermissionMode}（可选 native、full）`,
  )
}
const requestedAgentProtocol = String(
  process.env.AGENT_PROTOCOL || 'opencode',
).toLowerCase()
const sharedBackendAgent = String(
  process.env.QWEN_AUDIO_AGENT_BACKEND_AGENT || '',
).trim()
function legacyBackendAgent(value, legacyDefault) {
  const selected = String(value || '').trim()
  return selected === legacyDefault ? 'qwen-audio-agent-backend' : selected
}

export const config = {
  root,
  host: process.env.HOST || '127.0.0.1',
  port: numberSetting(process.env.PORT, 3101, { min: 1, max: 65535 }),
  audioProvider: String(
    process.env.QWEN_AUDIO_REALTIME_PROVIDER || 'dashscope',
  ).trim().toLowerCase(),
  dashscopeApiKey: (
    process.env.QWEN_AUDIO_REALTIME_API_KEY
    || process.env.DASHSCOPE_API_KEY
    || ''
  ),
  audioRealtimeBaseUrl: (
    process.env.QWEN_AUDIO_REALTIME_BASE_URL
    || process.env.QWEN_AUDIO_REALTIME_URL
    || (
      process.env.DASHSCOPE_WORKSPACE_ID
        ? `wss://${process.env.DASHSCOPE_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime`
        : 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'
    )
  ).replace(/\?+$/, ''),
  audioModel: process.env.QWEN_AUDIO_REALTIME_MODEL || 'qwen-audio-3.0-realtime-plus',
  audioVoice: process.env.QWEN_AUDIO_REALTIME_VOICE || 'longanqian',
  allowedOrigins: String(process.env.QWEN_AUDIO_AGENT_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
  authSecret: process.env.QWEN_AUDIO_AGENT_AUTH_SECRET || '',
  identityMode: (
    process.env.QWEN_AUDIO_AGENT_IDENTITY_MODE || 'personal'
  ).toLowerCase() === 'browser' ? 'browser' : 'personal',
  personalOwnerId: process.env.QWEN_AUDIO_AGENT_PERSONAL_OWNER_ID || 'user_personal',
  agentProtocol: ['openclaw', 'qoder'].includes(requestedAgentProtocol)
    ? requestedAgentProtocol
    : 'opencode',
  backendMode,
  backendPermissionMode,
  agentTimeoutMs: numberSetting(process.env.AGENT_TIMEOUT_MS, 300000, { min: 10000 }),
  openClawBaseUrl: (
    process.env.OPENCLAW_BASE_URL
    || 'http://127.0.0.1:18789'
  ).replace(/\/+$/, ''),
  openClawToken: (
    process.env.OPENCLAW_GATEWAY_TOKEN
    || process.env.AGENT_API_KEY
    || process.env.QWEN_AUDIO_AGENT_AUTH_SECRET
    || ''
  ),
  openClawCoordinatorAgent: (
    sharedBackendAgent
    || legacyBackendAgent(
      process.env.OPENCLAW_COORDINATOR_AGENT,
      'voice-coordinator',
    )
    || (backendMode === 'managed' ? 'qwen-audio-agent-backend' : '')
  ),
  openCodeBaseUrl: (
    process.env.OPENCODE_BASE_URL
    || 'http://127.0.0.1:4096'
  ).replace(/\/+$/, ''),
  openCodeUsername: process.env.OPENCODE_SERVER_USERNAME || 'opencode',
  openCodePassword: process.env.OPENCODE_SERVER_PASSWORD || '',
  openCodeDirectory: resolveOpenCodeWorkspace(),
  qoderDirectory: resolveQoderWorkspace(),
  qoderConfigDirectory: process.env.QODER_CONFIG_DIR
    ? resolve(process.env.QODER_CONFIG_DIR)
    : '',
  qoderCliPath: String(
    process.env.QODERCLI_PATH || process.env.QODER_CLI_PATH || '',
  ).trim(),
  qoderAuthMode: (
    String(process.env.QODER_AUTH_MODE || 'cli').toLowerCase() === 'token'
      ? 'token'
      : 'cli'
  ),
  qoderTokenEnv: String(
    process.env.QODER_TOKEN_ENV || 'QODER_PERSONAL_ACCESS_TOKEN',
  ).trim(),
  qoderModel: String(process.env.QODER_MODEL || 'auto').trim() || 'auto',
  openCodeModel: (
    process.env.OPENCODE_MODEL
    || (backendMode === 'managed' ? backendModels.openCode : '')
  ),
  openClawModel: (
    process.env.OPENCLAW_MODEL
    || (backendMode === 'managed' ? backendModels.openClaw : '')
  ),
  backendModel: backendMode === 'managed' ? backendModels.common : '',
  openCodeCoordinatorAgent: (
    sharedBackendAgent
    || legacyBackendAgent(
      process.env.OPENCODE_COORDINATOR_AGENT,
      'qwen-audio-agent-coordinator',
    )
    || (backendMode === 'managed' ? 'qwen-audio-agent-backend' : '')
  ),
  announceIntoContext: (
    String(process.env.QWEN_AUDIO_AGENT_ANNOUNCE_INTO_CONTEXT || 'true').toLowerCase()
    === 'true'
  ),
  resultContextMaxChars: numberSetting(
    process.env.QWEN_AUDIO_AGENT_RESULT_CONTEXT_MAX_CHARS,
    6000,
    { min: 256 },
  ),
  announcementBatchMs: numberSetting(
    process.env.QWEN_AUDIO_AGENT_ANNOUNCEMENT_BATCH_MS,
    120,
    { min: 0, max: 1000 },
  ),
  announcementMaxBatchItems: numberSetting(
    process.env.QWEN_AUDIO_AGENT_ANNOUNCEMENT_MAX_BATCH_ITEMS,
    8,
    { min: 1, max: 32 },
  ),
  announcementQuietMs: numberSetting(
    process.env.QWEN_AUDIO_AGENT_ANNOUNCEMENT_QUIET_MS,
    350,
    { min: 0, max: 2000 },
  ),
  announcementAcknowledgementTimeoutMs: numberSetting(
    process.env.QWEN_AUDIO_AGENT_ANNOUNCEMENT_ACK_TIMEOUT_MS,
    120_000,
    { min: 10_000 },
  ),
  announcementMaxRetryAttempts: numberSetting(
    process.env.QWEN_AUDIO_AGENT_ANNOUNCEMENT_MAX_RETRIES,
    8,
    { min: 1, max: 32 },
  ),
  frontendPromptDir: process.env.QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR
    ? resolve(root, process.env.QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR)
    : resolve(root, 'config/frontend-agent'),
  frontendMemoryPath: process.env.QWEN_AUDIO_AGENT_FRONTEND_MEMORY_PATH
    ? resolve(root, process.env.QWEN_AUDIO_AGENT_FRONTEND_MEMORY_PATH)
    : runtimeEnvironment.frontendMemoryPath,
  userProfilePath: process.env.QWEN_AUDIO_AGENT_USER_PROFILE_PATH
    ? resolve(root, process.env.QWEN_AUDIO_AGENT_USER_PROFILE_PATH)
    : runtimeEnvironment.userProfilePath,
  taskStatePath: process.env.QWEN_AUDIO_AGENT_TASK_STATE_PATH
    ? resolve(root, process.env.QWEN_AUDIO_AGENT_TASK_STATE_PATH)
    : runtimeEnvironment.taskStatePath,
  taskTerminalTtlMs: numberSetting(
    process.env.QWEN_AUDIO_AGENT_TASK_TERMINAL_TTL_MS,
    86_400_000,
    { min: 60_000 },
  ),
  taskPendingNotificationTtlMs: numberSetting(
    process.env.QWEN_AUDIO_AGENT_TASK_NOTIFICATION_TTL_MS,
    604_800_000,
    { min: 60_000 },
  ),
  taskNotificationClaimTtlMs: numberSetting(
    process.env.QWEN_AUDIO_AGENT_TASK_NOTIFICATION_CLAIM_TTL_MS,
    60_000,
    { min: 5_000 },
  ),
  maxTerminalTasksPerOwner: numberSetting(
    process.env.QWEN_AUDIO_AGENT_MAX_TERMINAL_TASKS_PER_OWNER,
    100,
    { min: 10 },
  ),
  taskMaxConcurrent: numberSetting(
    process.env.QWEN_AUDIO_AGENT_TASK_MAX_CONCURRENT,
    4,
    { min: 1, max: 64 },
  ),
  taskMaxConcurrentPerOwner: numberSetting(
    process.env.QWEN_AUDIO_AGENT_TASK_MAX_CONCURRENT_PER_OWNER,
    2,
    { min: 1, max: 16 },
  ),
  conversationSessionTtlMs: numberSetting(
    process.env.QWEN_AUDIO_AGENT_SESSION_TTL_MS,
    21_600_000,
    { min: 60_000 },
  ),
  maxConversationSessions: numberSetting(
    process.env.QWEN_AUDIO_AGENT_MAX_SESSIONS,
    500,
    { min: 10 },
  ),
  // Zero keeps explicit personal memories until the user removes them.
  frontendMemoryOwnerTtlMs: numberSetting(
    process.env.QWEN_AUDIO_AGENT_MEMORY_OWNER_TTL_MS,
    0,
    { min: 0 },
  ),
  maxFrontendMemoryOwners: numberSetting(
    process.env.QWEN_AUDIO_AGENT_MAX_MEMORY_OWNERS,
    1000,
    { min: 10 },
  ),
}

export function realtimeUrl(baseUrl, model) {
  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}model=${encodeURIComponent(model)}`
}
