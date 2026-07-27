import { randomUUID } from 'node:crypto'

const COMMANDS = new Set(['gateway', 'tui', 'webui', 'status', 'config'])
const GATEWAY_ACTIONS = new Set([
  'run',
  'install',
  'start',
  'stop',
  'restart',
  'status',
  'uninstall',
])
const BACKENDS = new Set(['opencode', 'openclaw'])
const BACKEND_MODES = new Set(['managed', 'compatible'])
const TUI_AUDIO_MODES = new Set(['half', 'full'])

export function createVoiceSessionId() {
  return `voice-${randomUUID().replaceAll('-', '')}`
}

function nextValue(argv, index, option) {
  const value = argv[index + 1]
  if (!value || value.startsWith('-')) throw new Error(`${option} 缺少参数`)
  return value
}

function cleanOrigin(value, label) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`无效的${label}：${value}`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label}只支持 http 或 https`)
  }
  return url.origin
}

export function parseArguments(argv, env = process.env) {
  const args = [...argv]
  const first = args[0]
  const command = first && !first.startsWith('-') ? args.shift() : 'gateway'
  if (!COMMANDS.has(command)) throw new Error(`未知命令：${command}`)
  const gatewayAction = command === 'gateway'
    && args[0]
    && !args[0].startsWith('-')
    ? args.shift()
    : command === 'status' ? 'status' : 'run'
  if (command === 'gateway' && !GATEWAY_ACTIONS.has(gatewayAction)) {
    throw new Error(`未知 Gateway 命令：${gatewayAction}`)
  }

  const options = {
    command,
    gatewayAction,
    url: env.QWEN_AUDIO_AGENT_URL || 'http://127.0.0.1:3101',
    sessionId: env.QWEN_AUDIO_AGENT_SESSION_ID || createVoiceSessionId(),
    audioMode: String(
      env.QWEN_AUDIO_AGENT_TUI_AUDIO_MODE || 'half',
    ).toLowerCase(),
    backend: String(env.AGENT_PROTOCOL || 'opencode').toLowerCase(),
    backendMode: String(
      env.QWEN_AUDIO_AGENT_BACKEND_MODE || 'managed',
    ).toLowerCase(),
    backendAgent: String(
      env.QWEN_AUDIO_AGENT_BACKEND_AGENT || '',
    ).trim(),
    backendUrl: '',
    openBrowser: true,
    takeover: false,
    gatewayConfigurationSpecified: false,
  }
  let audioModeSpecified = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--url') {
      options.url = nextValue(args, index++, '--url')
      options.gatewayConfigurationSpecified = true
    } else if (argument === '--backend') {
      options.backend = nextValue(args, index++, '--backend').toLowerCase()
      options.gatewayConfigurationSpecified = true
    } else if (argument === '--backend-mode') {
      options.backendMode = nextValue(
        args,
        index++,
        '--backend-mode',
      ).toLowerCase()
      options.gatewayConfigurationSpecified = true
    } else if (argument === '--backend-agent') {
      options.backendAgent = nextValue(args, index++, '--backend-agent').trim()
      options.gatewayConfigurationSpecified = true
    } else if (argument === '--backend-url') {
      options.backendUrl = nextValue(args, index++, '--backend-url')
      options.gatewayConfigurationSpecified = true
    } else if (argument === '--session') {
      options.sessionId = nextValue(args, index++, '--session')
    } else if (argument === '--audio-mode') {
      options.audioMode = nextValue(args, index++, '--audio-mode').toLowerCase()
      audioModeSpecified = true
    } else if (argument === '--no-open') options.openBrowser = false
    else if (argument === '--takeover') options.takeover = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`未知参数：${argument}`)
  }

  if (!BACKENDS.has(options.backend)) {
    throw new Error(`不支持的后台：${options.backend}（可选 opencode、openclaw）`)
  }
  if (!BACKEND_MODES.has(options.backendMode)) {
    throw new Error(
      `不支持的后台模式：${options.backendMode}（可选 managed、compatible）`,
    )
  }
  if (command !== 'webui' && !options.openBrowser) {
    throw new Error('--no-open 只适用于 webui')
  }
  if (!['tui', 'webui'].includes(command) && options.takeover) {
    throw new Error('--takeover 只适用于 tui 或 webui')
  }
  if (command !== 'tui' && audioModeSpecified) {
    throw new Error('--audio-mode 只适用于 tui')
  }
  if (command === 'tui' && !TUI_AUDIO_MODES.has(options.audioMode)) {
    throw new Error(
      `不支持的音频模式：${options.audioMode}（可选 half、full）`,
    )
  }
  if (
    command === 'gateway'
    && !['run', 'status'].includes(options.gatewayAction)
    && options.gatewayConfigurationSpecified
  ) {
    throw new Error(
      'Gateway 后台服务从 config.env 读取配置；请先修改配置，再执行服务命令',
    )
  }

  options.url = cleanOrigin(options.url, ' Gateway URL')
  const configuredBackendUrl = options.backend === 'openclaw'
    ? env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789'
    : env.OPENCODE_BASE_URL || 'http://127.0.0.1:4096'
  options.backendUrl = cleanOrigin(
    options.backendUrl || configuredBackendUrl,
    '后台地址',
  )
  options.sessionId = String(options.sessionId || '').trim()
  if (!options.sessionId) throw new Error('--session 不能为空')
  return options
}

export function helpText() {
  return [
    'qwenaudio',
    '',
    '用法：',
    '  qwenaudio [gateway] [run] [选项]  前台运行 Gateway（默认）',
    '  qwenaudio gateway install         安装并启动后台常驻服务',
    '  qwenaudio gateway start           启动后台服务',
    '  qwenaudio gateway status          查看 Gateway 状态',
    '  qwenaudio gateway stop            停止后台服务',
    '  qwenaudio gateway restart         重启后台服务',
    '  qwenaudio gateway uninstall       移除后台常驻服务',
    '  qwenaudio tui [选项]         连接现有 Gateway 的终端界面',
    '  qwenaudio webui [选项]       打开现有 Gateway 的 WebUI',
    '  qwenaudio status [选项]      gateway status 的兼容别名',
    '  qwenaudio config             显示用户配置文件位置',
    '',
    'Gateway 选项：',
    '  --url URL              Gateway 地址（默认 http://127.0.0.1:3101）',
    '  --backend NAME         opencode（默认）或 openclaw',
    '  --backend-mode MODE    managed（默认）或 compatible',
    '  --backend-url URL      后台 Server 地址',
    '  --backend-agent ID     compatible 模式使用的 Agent',
    '',
    '界面选项：',
    '  --session ID           复用指定语音会话',
    '  --audio-mode MODE      Linux / Windows 使用 half（默认）或 full',
    '  --takeover             接管当前语音控制权',
    '  --no-open              WebUI 只打印地址，不打开浏览器',
    '  -h, --help             显示帮助',
    '',
    'TUI 按键：',
    '  x                      半双工模式下手动打断当前回复',
    '  m                      静音 / 恢复麦克风',
    '  h                      在 TUI 内显示帮助',
    '  q                      退出 TUI',
  ].join('\n')
}
