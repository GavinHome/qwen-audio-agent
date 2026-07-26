import { randomUUID } from 'node:crypto'

const COMMANDS = new Set(['gateway', 'tui', 'webui', 'status', 'config'])
const TUI_MODES = new Set(['minimal', 'full'])
const BACKENDS = new Set(['opencode', 'openclaw'])
const BACKEND_MODES = new Set(['managed', 'compatible'])

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

  const options = {
    command,
    mode: 'minimal',
    url: env.QWEN_AUDIO_AGENT_URL || 'http://127.0.0.1:3101',
    sessionId: env.QWEN_AUDIO_AGENT_SESSION_ID || createVoiceSessionId(),
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
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--mode') {
      options.mode = nextValue(args, index++, '--mode')
    } else if (argument === '--url') {
      options.url = nextValue(args, index++, '--url')
    } else if (argument === '--backend') {
      options.backend = nextValue(args, index++, '--backend').toLowerCase()
    } else if (argument === '--backend-mode') {
      options.backendMode = nextValue(
        args,
        index++,
        '--backend-mode',
      ).toLowerCase()
    } else if (argument === '--backend-agent') {
      options.backendAgent = nextValue(args, index++, '--backend-agent').trim()
    } else if (argument === '--backend-url') {
      options.backendUrl = nextValue(args, index++, '--backend-url')
    } else if (argument === '--session') {
      options.sessionId = nextValue(args, index++, '--session')
    } else if (argument === '--no-open') options.openBrowser = false
    else if (argument === '--takeover') options.takeover = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`未知参数：${argument}`)
  }

  if (!TUI_MODES.has(options.mode)) {
    throw new Error(`不支持的 TUI 模式：${options.mode}（可选 minimal、full）`)
  }
  if (!BACKENDS.has(options.backend)) {
    throw new Error(`不支持的后台：${options.backend}（可选 opencode、openclaw）`)
  }
  if (!BACKEND_MODES.has(options.backendMode)) {
    throw new Error(
      `不支持的后台模式：${options.backendMode}（可选 managed、compatible）`,
    )
  }
  if (command !== 'tui' && args.includes('--mode')) {
    throw new Error('--mode 只适用于 tui')
  }
  if (command !== 'webui' && !options.openBrowser) {
    throw new Error('--no-open 只适用于 webui')
  }
  if (!['tui', 'webui'].includes(command) && options.takeover) {
    throw new Error('--takeover 只适用于 tui 或 webui')
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
    '  qwenaudio [gateway] [选项]   启动 Gateway（默认）',
    '  qwenaudio tui [选项]         连接现有 Gateway 的终端界面',
    '  qwenaudio webui [选项]       打开现有 Gateway 的 WebUI',
    '  qwenaudio status [选项]      查看 Gateway 状态',
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
    '  --mode minimal|full    TUI 模式（默认 minimal）',
    '  --session ID           复用指定语音会话',
    '  --takeover             接管当前语音控制权',
    '  --no-open              WebUI 只打印地址，不打开浏览器',
    '  -h, --help             显示帮助',
  ].join('\n')
}
