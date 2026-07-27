import { randomBytes, randomUUID } from 'node:crypto'
import { AgentError, BackendAdapter, requestSignal } from './backend-adapter.mjs'
import { BACKEND_AGENT_INSTRUCTIONS } from './backend-agent-instructions.mjs'
import { nestedValue, OpenCodeEventStream } from './opencode-event-stream.mjs'

const MANAGED_AGENT = 'qwen-audio-agent-backend'
const MANAGED_SESSION_TOOLS = [
  'qwen_audio_agent_sessions_list',
  'qwen_audio_agent_session_start',
  'qwen_audio_agent_session_send',
  'qwen_audio_agent_session_status',
  'qwen_audio_agent_session_cancel',
]
const DELEGATION_TOOLS = new Set([
  'qwen_audio_agent_session_start',
  'qwen_audio_agent_session_send',
])
const MAX_DELEGATION_RESULT_CHARS = 12_000
const DELEGATION_TURN_GRACE_MS = 30_000

function agentSessionKey(ownerId, role) {
  return `qwen-audio-agent:${encodeURIComponent(String(ownerId || 'personal'))}:${role}`
}

function modelRef(value) {
  const [providerID, ...parts] = String(value || '').split('/')
  const modelID = parts.join('/')
  return providerID && modelID ? { providerID, modelID } : null
}

function responseText(payload) {
  if (payload?.info?.structured !== undefined) {
    return JSON.stringify(payload.info.structured)
  }
  return (payload?.parts || [])
    .filter(part => part?.type === 'text')
    .map(part => part.text || '')
    .join('\n')
    .trim()
}

function responseFailure(payload) {
  const error = payload?.info?.error
  if (!error) return null
  return error.data?.message || error.message || error.name || 'OpenCode 执行失败'
}

function latestAssistantResult(messages = [], startedAt = 0) {
  for (const message of [...messages].reverse()) {
    if (message?.info?.role !== 'assistant') continue
    const createdAt = Number(message.info?.time?.created || 0)
    if (startedAt && createdAt && createdAt < startedAt) continue
    const text = responseText(message)
    if (text) return { message, text }
  }
  return null
}

function jsonObject(value) {
  if (value && typeof value === 'object') return value
  try {
    const parsed = JSON.parse(String(value || ''))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function responseObject(payload) {
  const content = responseText(payload)
  const direct = jsonObject(content)
  if (direct) return direct
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced || content.slice(
    content.indexOf('{'),
    content.lastIndexOf('}') + 1,
  )
  return jsonObject(candidate)
}

function delegationPresentation(payload) {
  const presentation = responseObject(payload)?.presentation
  if (!presentation || typeof presentation !== 'object') return null
  const speech = boundedText(presentation.speech, 1200)
  const inline = presentation.inline
  return {
    speech,
    inline: inline && typeof inline === 'object'
      ? {
          title: boundedText(inline.title, 120),
          format: ['markdown', 'code', 'link'].includes(inline.format)
            ? inline.format
            : 'markdown',
          content: String(inline.content || '').trim().slice(0, 12_000),
        }
      : null,
  }
}

export function eventDelegation(event) {
  if (event?.type !== 'message.part.updated') return null
  const part = nestedValue(event.payload || {}, ['part'])
  if (
    part?.type !== 'tool'
    || !DELEGATION_TOOLS.has(part.tool)
    || part.state?.status !== 'completed'
  ) return null
  const output = jsonObject(part.state?.output)
  const delegationId = String(output?.delegation_id || '')
  const sessionId = String(output?.session_id || '')
  if (output?.status !== 'started' || !delegationId || !sessionId) return null
  return {
    id: delegationId,
    sessionId,
    title: String(output.title || ''),
    directory: String(output.directory || event.directory || ''),
    tool: part.tool,
  }
}

export function eventActivity(event) {
  if (event?.type === 'message.part.updated') {
    const part = nestedValue(event.payload || {}, ['part'])
    if (!part || typeof part !== 'object') return null
    if (part.type === 'tool') {
      const state = part.state || {}
      const input = state.input || {}
      const hint = `${part.tool || ''} ${input.command || ''} ${
        input.description || input.query || input.filePath || input.pattern || ''
      }`.toLowerCase()
      const detail = String(
        input.description
        || input.query
        || input.filePath
        || input.pattern
        || state.title
        || '',
      )
      return {
        id: part.id || null,
        kind: 'tool',
        tool: part.tool || 'tool',
        status: state.status || 'running',
        category: /image|imagegen|图片|图像|绘图/.test(hint)
          ? 'image'
          : /search|web|fetch|搜索|查询/.test(hint)
            ? 'search'
            : /read|glob|grep|list|读取|查找/.test(hint)
              ? 'read'
              : /write|edit|patch|写入|修改/.test(hint)
                ? 'write'
                : 'run',
        detail: detail.slice(0, 300),
      }
    }
    if (part.type === 'text' || part.type === 'reasoning') {
      return {
        id: part.id || null,
        kind: part.type,
        status: 'running',
      }
    }
  }
  return null
}

function boundedText(value, max = 300) {
  return String(value || '')
    .replace(
      /((?:password|secret|api[_ -]?key|access[_ -]?token|credential)\s*[=:]\s*)\S+/gi,
      '$1[已隐藏]',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function permissionSummary(properties = {}) {
  const metadata = properties.metadata || {}
  const details = [
    metadata.description,
    metadata.command,
    metadata.filePath,
    metadata.path,
    ...(properties.patterns || []),
  ].map(value => boundedText(value)).filter(Boolean)
  const labels = {
    bash: '运行命令',
    edit: '修改文件',
    external_directory: '访问工作区之外的文件',
    webfetch: '访问网络地址',
    websearch: '执行网络搜索',
    task: '启动子任务',
    skill: '加载技能',
    doom_loop: '继续重复执行',
  }
  const action = boundedText(properties.permission, 80) || '执行受限操作'
  const label = labels[action] || `执行 ${action}`
  return details.length ? `${label}：${details.slice(0, 3).join('；')}` : label
}

let lastTimestamp = 0
let counter = 0

function messageId() {
  const timestamp = Date.now()
  counter = timestamp === lastTimestamp ? counter + 1 : 1
  lastTimestamp = timestamp
  const time = (BigInt(timestamp) * 0x1000n + BigInt(counter))
    .toString(16)
    .padStart(12, '0')
    .slice(-12)
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const suffix = [...randomBytes(14)]
    .map(byte => alphabet[byte % alphabet.length])
    .join('')
  return `msg_${time}${suffix}`
}

export class OpenCodeAdapter extends BackendAdapter {
  protocol = 'opencode'

  constructor(options) {
    super(options)
    this.directory = options.directory
    this.username = options.username || 'opencode'
    this.password = options.password || ''
    this.mode = options.mode === 'compatible' ? 'compatible' : 'managed'
    this.backendAgent = String(options.coordinatorAgent || '').trim()
      || (this.mode === 'managed' ? MANAGED_AGENT : '')
    this.resolvedAgent = null
    this.sessionCache = new Map()
    this.sessionPromises = new Map()
    this.sessionQueues = new Map()
    this.activeRuns = new Map()
    this.delegatedRuns = new Map()
    this.pendingPermissions = new Map()
    this.permissionByRequest = new Map()
    this.permissionRoutingPromises = new Map()
    this.events = new OpenCodeEventStream({
      fetchImpl: this.fetch,
      baseUrl: this.baseUrl,
      headers: () => this.headers(),
    })
  }

  async permissionRun(event) {
    const properties = event?.payload?.properties || {}
    const permissionSessionId = String(properties.sessionID || event.sessionId || '')
    if (!permissionSessionId) return null
    if (this.activeRuns.has(permissionSessionId)) {
      return {
        backendSessionId: permissionSessionId,
        run: this.activeRuns.get(permissionSessionId),
      }
    }
    const query = event.directory
      ? `?directory=${encodeURIComponent(event.directory)}`
      : ''
    const response = await this.request(
      `/session/${encodeURIComponent(permissionSessionId)}${query}`,
      {
        method: 'GET',
        headers: this.headers(),
        timeoutMs: 5000,
      },
    )
    const session = await response.json()
    const delegationId = String(
      session?.metadata?.qwen_audio_agent_run_id || '',
    )
    if (delegationId && this.delegatedRuns.has(delegationId)) {
      const run = this.delegatedRuns.get(delegationId)
      return {
        backendSessionId: run.backendSessionId,
        run,
      }
    }
    const backendSessionId = String(
      session?.metadata?.qwen_audio_agent_backend_session_id
      || session?.metadata?.qwen_audio_agent_coordinator_session_id
      || '',
    )
    return backendSessionId && this.activeRuns.has(backendSessionId)
      ? { backendSessionId, run: this.activeRuns.get(backendSessionId) }
      : null
  }

  handlePermissionAsked(event) {
    const properties = event?.payload?.properties || {}
    const requestId = String(properties.id || '')
    if (!requestId || this.permissionByRequest.has(requestId)) return
    if (this.permissionRoutingPromises.has(requestId)) return
    const pending = this.permissionRun(event)
      .then(routing => {
        if (!routing || this.permissionByRequest.has(requestId)) return
        const id = `auth_${randomUUID().replaceAll('-', '')}`
        const permission = {
          id,
          workId: routing.run.coordinationRunId || null,
          status: 'pending',
          category: boundedText(properties.permission, 80) || 'unknown',
          summary: permissionSummary(properties),
          patterns: (properties.patterns || [])
            .map(value => boundedText(value))
            .filter(Boolean)
            .slice(0, 5),
        }
        const record = {
          ...permission,
          ownerId: routing.run.ownerId,
          backendSessionId: routing.backendSessionId,
          permissionSessionId: String(properties.sessionID || event.sessionId),
          requestId,
          directory: event.directory || this.directory,
          onEvent: routing.run.onEvent,
        }
        this.pendingPermissions.set(id, record)
        this.permissionByRequest.set(requestId, id)
        routing.run.onEvent?.({
          type: 'backend.permission.requested',
          permission,
        })
      })
      .catch(() => {})
      .finally(() => this.permissionRoutingPromises.delete(requestId))
    this.permissionRoutingPromises.set(requestId, pending)
  }

  handlePermissionEvent(event) {
    if (event?.type === 'permission.asked') {
      this.handlePermissionAsked(event)
      return
    }
    if (event?.type === 'permission.replied') {
      const properties = event?.payload?.properties || {}
      const id = this.permissionByRequest.get(String(properties.requestID || ''))
      const record = id ? this.pendingPermissions.get(id) : null
      if (!record) return
      this.resolvePermissionRecord(
        record,
        properties.reply === 'reject' ? 'denied' : 'approved',
      )
    }
  }

  resolvePermissionRecord(record, status) {
    if (!record || record.status !== 'pending') return false
    record.status = status
    record.onEvent?.({
      type: 'backend.permission.resolved',
      permission: {
        id: record.id,
        workId: record.workId,
        status: record.status,
        category: record.category,
        summary: record.summary,
      },
    })
    this.pendingPermissions.delete(record.id)
    this.permissionByRequest.delete(record.requestId)
    return true
  }

  async respondPermission(id, decision, { ownerId } = {}) {
    const record = this.pendingPermissions.get(String(id || ''))
    if (
      !record
      || record.status !== 'pending'
      || (ownerId !== undefined && record.ownerId !== String(ownerId))
    ) {
      throw new AgentError('这个权限请求已经失效或不属于当前用户', {
        status: 404,
        protocol: this.protocol,
      })
    }
    const reply = decision === 'always'
      ? 'always'
      : decision === 'reject' ? 'reject' : ''
    if (!reply) {
      throw new AgentError('不支持的权限响应', {
        status: 400,
        protocol: this.protocol,
      })
    }
    const query = record.directory
      ? `?directory=${encodeURIComponent(record.directory)}`
      : ''
    await this.request(
      `/permission/${encodeURIComponent(record.requestId)}/reply${query}`,
      {
        headers: this.headers(),
        timeoutMs: 5000,
        body: { reply },
      },
    )
    this.resolvePermissionRecord(
      record,
      reply === 'always' ? 'approved' : 'denied',
    )
    return {
      id: record.id,
      workId: record.workId,
      status: record.status,
      category: record.category,
      summary: record.summary,
    }
  }

  get label() {
    return 'OpenCode'
  }

  headers() {
    return {
      ...(this.password
        ? {
            Authorization: `Basic ${Buffer.from(
              `${this.username}:${this.password}`,
            ).toString('base64')}`,
          }
        : {}),
      ...(this.directory
        ? { 'x-opencode-directory': encodeURIComponent(this.directory) }
        : {}),
    }
  }

  describe() {
    return {
      kind: this.protocol,
      label: this.label,
      baseUrl: this.baseUrl,
      uiPath: '/api/backend/ui',
      model: this.model || null,
      directory: this.directory,
      mode: this.mode,
      backendAgent: this.resolvedAgent || this.backendAgent || null,
      sessionModel: 'one-persistent-backend-agent',
    }
  }

  async uiUrl(ownerId) {
    const session = await this.ensureSession(ownerId)
    const serverKey = Buffer.from(this.baseUrl).toString('base64url')
    return `${
      this.baseUrl
    }/server/${serverKey}/session/${encodeURIComponent(session.id)}`
  }

  async health() {
    const response = await this.request('/global/health', {
      method: 'GET',
      headers: this.headers(),
      timeoutMs: 5000,
    })
    const payload = await response.json()
    const backendAgent = await this.resolveBackendAgent()
    let enhanced = false
    if (this.mode === 'managed') {
      const toolsResponse = await this.request('/experimental/tool/ids', {
        method: 'GET',
        headers: this.headers(),
        timeoutMs: 5000,
      })
      const tools = await toolsResponse.json()
      const missing = MANAGED_SESSION_TOOLS.filter(name => !tools.includes(name))
      if (missing.length) {
        throw new AgentError(
          `OpenCode 未加载 qwen-audio-agent Session 插件：${missing.join(', ')}`,
          { protocol: this.protocol },
        )
      }
      enhanced = true
    }
    return {
      ok: payload.healthy === true,
      status: response.status,
      version: payload.version,
      protocol: this.protocol,
      mode: this.mode,
      backendAgent,
      enhanced,
    }
  }

  async listAgents() {
    const response = await this.request('/agent', {
      method: 'GET',
      headers: this.headers(),
      timeoutMs: 5000,
    })
    return response.json()
  }

  async resolveBackendAgent() {
    if (this.resolvedAgent) return this.resolvedAgent
    const agents = await this.listAgents()
    const available = agents.filter(agent => !agent?.hidden)
    let selected
    if (this.backendAgent) {
      selected = available.find(agent => agent?.name === this.backendAgent)
      if (!selected) {
        throw new AgentError(
          `OpenCode 中不存在后台 Agent "${this.backendAgent}"`,
          { protocol: this.protocol },
        )
      }
    } else {
      selected = (
        available.find(agent => agent?.name === 'build')
        || available.find(agent => agent?.mode === 'primary')
        || available[0]
      )
    }
    if (!selected?.name) {
      throw new AgentError('OpenCode 没有可用的后台 Agent', {
        protocol: this.protocol,
      })
    }
    this.resolvedAgent = selected.name
    return this.resolvedAgent
  }

  async listSessions() {
    const query = new URLSearchParams({ limit: '100' })
    if (this.directory) query.set('directory', this.directory)
    const response = await this.request(`/session?${query}`, {
      method: 'GET',
      headers: this.headers(),
    })
    return response.json()
  }

  async createSession(key, ownerId, backendAgent) {
    const response = await this.request('/session', {
      headers: this.headers(),
      body: {
        title: 'qwen-audio-agent · Backend Agent',
        agent: backendAgent,
        metadata: {
          qwen_audio_agent_backend_key: key,
          qwen_audio_agent_role: 'backend',
          qwen_audio_agent_owner_id: String(ownerId || ''),
        },
      },
    })
    return response.json()
  }

  async normalizeBackendSession(session) {
    if (!session?.title || session.title === 'qwen-audio-agent · Backend Agent') {
      return session
    }
    const response = await this.request(
      `/session/${encodeURIComponent(session.id)}`,
      {
        method: 'PATCH',
        headers: this.headers(),
        body: { title: 'qwen-audio-agent · Backend Agent' },
      },
    )
    return response.json()
  }

  ensureSession(ownerId) {
    const key = agentSessionKey(ownerId, 'backend')
    if (this.sessionCache.has(key)) {
      return Promise.resolve(this.sessionCache.get(key))
    }
    if (this.sessionPromises.has(key)) return this.sessionPromises.get(key)
    const pending = this.resolveBackendAgent()
      .then(async backendAgent => ({
        backendAgent,
        sessions: await this.listSessions(),
      }))
      .then(({ backendAgent, sessions }) => (
        sessions
          .filter(session => (
            session?.metadata?.qwen_audio_agent_backend_key === key
            && session?.metadata?.qwen_audio_agent_role === 'backend'
          ))
          .sort((left, right) => (
            Number(right.time?.updated || right.time?.created || 0)
            - Number(left.time?.updated || left.time?.created || 0)
          ))[0]
        || this.createSession(key, ownerId, backendAgent)
      ))
      .then(session => this.normalizeBackendSession(session))
      .then(session => {
        if (!session?.id) {
          throw new AgentError('OpenCode 没有返回有效的后台 Agent Session', {
            protocol: this.protocol,
          })
        }
        this.sessionCache.set(key, session)
        return session
      })
      .finally(() => this.sessionPromises.delete(key))
    this.sessionPromises.set(key, pending)
    return pending
  }

  serialize(sessionId, operation) {
    const previous = this.sessionQueues.get(sessionId) || Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    this.sessionQueues.set(sessionId, current)
    current.finally(() => {
      if (this.sessionQueues.get(sessionId) === current) {
        this.sessionQueues.delete(sessionId)
      }
    }).catch(() => {})
    return current
  }

  async delegationStatus(delegation) {
    const query = new URLSearchParams()
    if (delegation.directory) query.set('directory', delegation.directory)
    const response = await this.request(
      `/session/status${query.size ? `?${query}` : ''}`,
      {
        method: 'GET',
        headers: this.headers(),
        timeoutMs: 5000,
      },
    )
    const statuses = await response.json()
    return statuses?.[delegation.sessionId]?.type || 'idle'
  }

  async readDelegationResult(delegation) {
    const query = new URLSearchParams()
    if (delegation.directory) query.set('directory', delegation.directory)
    const suffix = query.size ? `?${query}` : ''
    const sessionResponse = await this.request(
      `/session/${encodeURIComponent(delegation.sessionId)}${suffix}`,
      {
        method: 'GET',
        headers: this.headers(),
        timeoutMs: 5000,
      },
    )
    const session = await sessionResponse.json()
    const metadata = session?.metadata || {}
    if (metadata.qwen_audio_agent_run_id !== delegation.id) return null
    const messagesQuery = new URLSearchParams(query)
    messagesQuery.set('limit', '20')
    const messagesResponse = await this.request(
      `/session/${encodeURIComponent(delegation.sessionId)}/message?${
        messagesQuery
      }`,
      {
        method: 'GET',
        headers: this.headers(),
        timeoutMs: 5000,
      },
    )
    const messages = await messagesResponse.json()
    const result = latestAssistantResult(
      messages,
      Number(metadata.qwen_audio_agent_run_started_at || 0),
    )
    if (!result) return null
    await this.request(
      `/session/${encodeURIComponent(delegation.sessionId)}${suffix}`,
      {
        method: 'PATCH',
        headers: this.headers(),
        timeoutMs: 5000,
        body: {
          metadata: {
            ...metadata,
            qwen_audio_agent_delivery_pending: false,
            qwen_audio_agent_delivered_run_id: delegation.id,
            qwen_audio_agent_delivered_message_id:
              result.message.info?.id || null,
          },
        },
      },
    )
    return {
      id: delegation.id,
      sessionId: delegation.sessionId,
      title: session.title || delegation.title,
      directory: session.directory || delegation.directory,
      result: result.text.slice(0, MAX_DELEGATION_RESULT_CHARS),
    }
  }

  settleDelegation(run) {
    const delegation = run.delegation
    if (!delegation || delegation.settling || delegation.settled) return
    delegation.settling = true
    this.delegationStatus(delegation)
      .then(status => (
        status === 'busy'
          ? { stillBusy: true }
          : this.readDelegationResult(delegation)
      ))
      .then(result => {
        if (result?.stillBusy) {
          delegation.settling = false
          if (delegation.idleObserved) {
            delegation.settleAttempts =
              (delegation.settleAttempts || 0) + 1
            if (delegation.settleAttempts >= 20) {
              delegation.settled = true
              delegation.reject(new AgentError(
                '目标 OpenCode Session 已报告完成，但状态仍为运行中',
                { protocol: this.protocol },
              ))
              return
            }
            const timer = setTimeout(
              () => this.settleDelegation(run),
              Math.min(1000, delegation.settleAttempts * 100),
            )
            timer.unref?.()
          }
          return
        }
        if (!result) {
          delegation.settling = false
          delegation.settleAttempts = (delegation.settleAttempts || 0) + 1
          if (delegation.settleAttempts >= 20) {
            delegation.settled = true
            delegation.reject(new AgentError(
              '目标 OpenCode Session 已结束，但没有返回最终结果',
              { protocol: this.protocol },
            ))
            return
          }
          const timer = setTimeout(
            () => this.settleDelegation(run),
            Math.min(1000, delegation.settleAttempts * 100),
          )
          timer.unref?.()
          return
        }
        delegation.settled = true
        delegation.resolve(result)
      })
      .catch(error => {
        delegation.settled = true
        delegation.reject(error)
      })
  }

  captureDelegation(event, run, abortCoordinator) {
    if (run.delegation) return
    const details = eventDelegation(event)
    if (!details) return
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    promise.catch(() => {})
    run.delegation = {
      ...details,
      promise,
      resolve,
      reject,
      settling: false,
      settled: false,
      turnTimer: null,
    }
    this.delegatedRuns.set(details.id, run)
    run.delegation.turnTimer = setTimeout(
      abortCoordinator,
      DELEGATION_TURN_GRACE_MS,
    )
    run.delegation.turnTimer.unref?.()
    queueMicrotask(async () => {
      try {
        if (await this.delegationStatus(details) !== 'busy') {
          this.settleDelegation(run)
        }
      } catch {
        // The matching session.idle event remains the source of truth.
      }
    })
  }

  handleDelegationEvent(event, run, abortCoordinator) {
    if (!run.delegation) {
      if (event?.sessionId !== run.backendSessionId) return
      this.captureDelegation(event, run, abortCoordinator)
    }
    if (
      event?.type === 'session.idle'
      && event.sessionId === run.delegation?.sessionId
    ) {
      run.delegation.idleObserved = true
      this.settleDelegation(run)
    }
  }

  delegationResultPrompt(result, coordinationRunId) {
    return [
      '<qwen_audio_agent_delegation_result>',
      JSON.stringify({
        kind: 'opencode_session_completed',
        work_id: coordinationRunId || '',
        delegation_id: result.id,
        session_id: result.sessionId,
        title: result.title,
        directory: result.directory,
        result: result.result,
      }),
      '</qwen_audio_agent_delegation_result>',
      '这是已验证的目标 OpenCode Session 最终结果，不是新的用户请求。',
      '不得再调用工具。只根据该结果生成最终 presentation。',
      '输出且只输出：',
      `{"work_id":"${coordinationRunId || ''}","state":"completed","mode":"respond","presentation":{"speech":"适合语音表达的最终结果","inline":null}}`,
    ].join('\n')
  }

  async executeCoordinatorRun(message, {
    session,
    backendAgent,
    ownerId,
    coordinationRunId,
    signal,
    onEvent,
    releaseCoordinator,
  }) {
    let backendAbortPromise = null
    const run = {
      ownerId: String(ownerId || ''),
      coordinationRunId: coordinationRunId || null,
      onEvent,
      backendSessionId: session.id,
      delegation: null,
      releaseCoordinator: null,
    }
    const activateBackend = () => {
      backendAbortPromise = null
      this.activeRuns.set(session.id, run)
    }
    const deactivateBackend = () => {
      if (this.activeRuns.get(session.id) === run) {
        this.activeRuns.delete(session.id)
      }
    }
    run.releaseCoordinator = () => {
      deactivateBackend()
      releaseCoordinator()
    }
    activateBackend()
    const combinedSignal = requestSignal(signal, this.timeoutMs)
    const runId = messageId()
    const abortPromises = []
    const abortBackend = () => {
      if (this.activeRuns.get(session.id) !== run) {
        return Promise.resolve(null)
      }
      if (backendAbortPromise) return backendAbortPromise
      backendAbortPromise = this.request(
        `/session/${encodeURIComponent(session.id)}/abort`,
        {
          headers: this.headers(),
          timeoutMs: 5000,
        },
      ).catch(() => null)
      abortPromises.push(backendAbortPromise)
      return backendAbortPromise
    }
    const abortDelegation = () => {
      const delegation = run.delegation
      if (!delegation || delegation.settled) return
      delegation.settled = true
      delegation.reject(
        signal?.reason
        || combinedSignal?.reason
        || new Error('后台委派已取消'),
      )
      const query = delegation.directory
        ? `?directory=${encodeURIComponent(delegation.directory)}`
        : ''
      abortPromises.push(this.request(
        `/session/${encodeURIComponent(delegation.sessionId)}/abort${query}`,
        {
          headers: this.headers(),
          timeoutMs: 5000,
        },
      ).catch(() => null))
    }
    const abortAll = () => {
      abortBackend()
      abortDelegation()
    }
    let delegatedAbortAttached = false
    combinedSignal?.addEventListener('abort', abortAll, { once: true })
    if (combinedSignal?.aborted) abortAll()
    onEvent?.({
      type: 'backend.bound',
      backendRef: {
        provider: this.protocol,
        role: 'backend',
        sessionId: session.id,
        directory: this.directory,
        runId,
      },
    })
    const stopObserving = this.events.subscribe({
      sessionId: '',
      directory: '',
      onEvent: event => {
        this.handlePermissionEvent(event)
        this.handleDelegationEvent(event, run, abortBackend)
        const activity = (
          event.sessionId === session.id
          && this.activeRuns.get(session.id) === run
        )
          ? eventActivity(event)
          : null
        if (activity) onEvent?.({ type: 'backend.activity', activity })
      },
    })
    const sendMessage = async (
      text,
      id,
      { compatible = false, requestAbortSignal = combinedSignal } = {},
    ) => {
      const response = await this.request(
        `/session/${encodeURIComponent(session.id)}/message`,
        {
          headers: this.headers(),
          signal: requestAbortSignal,
          timeoutMs: 0,
          body: {
            messageID: id,
            agent: backendAgent,
            ...(modelRef(this.model) ? { model: modelRef(this.model) } : {}),
            ...(compatible && this.mode === 'compatible'
              ? { system: BACKEND_AGENT_INSTRUCTIONS }
              : {}),
            parts: [{ type: 'text', text: String(text) }],
          },
        },
      )
      return response.json()
    }
    try {
      await this.events.ready?.(1000)
      let payload
      try {
        payload = await sendMessage(message, runId, { compatible: true })
      } catch (error) {
        if (!run.delegation) throw error
      } finally {
        combinedSignal?.removeEventListener('abort', abortAll)
      }
      if (!run.delegation) {
        const failure = responseFailure(payload)
        if (failure) {
          throw new AgentError(`OpenCode 执行失败：${failure}`, {
            body: JSON.stringify(payload),
            protocol: this.protocol,
          })
        }
      } else {
        signal?.addEventListener('abort', abortAll, { once: true })
        delegatedAbortAttached = Boolean(signal)
        if (signal?.aborted) abortAll()
        clearTimeout(run.delegation.turnTimer)
        run.delegation.turnTimer = null
        const presentation = delegationPresentation(payload)
        onEvent?.({
          type: 'backend.delegated',
          delegation: {
            id: run.delegation.id,
            sessionId: run.delegation.sessionId,
            title: run.delegation.title,
            directory: run.delegation.directory,
            presentation,
          },
        })
        deactivateBackend()
        run.releaseCoordinator?.()
        await Promise.allSettled(abortPromises)
        const delegatedResult = await run.delegation.promise
        onEvent?.({
          type: 'backend.delegation.completed',
          delegation: {
            id: delegatedResult.id,
            sessionId: delegatedResult.sessionId,
            title: delegatedResult.title,
            directory: delegatedResult.directory,
          },
        })
        payload = await this.serialize(session.id, async () => {
          activateBackend()
          const finalSignal = requestSignal(signal, this.timeoutMs)
          const abortFinal = () => abortBackend()
          finalSignal?.addEventListener('abort', abortFinal, { once: true })
          if (finalSignal?.aborted) abortFinal()
          try {
            return await sendMessage(
              this.delegationResultPrompt(
                delegatedResult,
                coordinationRunId,
              ),
              messageId(),
              { requestAbortSignal: finalSignal },
            )
          } finally {
            finalSignal?.removeEventListener('abort', abortFinal)
            deactivateBackend()
          }
        })
        const failure = responseFailure(payload)
        if (failure) {
          throw new AgentError(`OpenCode 整理委派结果失败：${failure}`, {
            body: JSON.stringify(payload),
            protocol: this.protocol,
          })
        }
      }
      const content = responseText(payload)
      if (!content) {
        throw new AgentError('OpenCode 返回了空结果', {
          body: JSON.stringify(payload),
          protocol: this.protocol,
        })
      }
      return {
        content,
        raw: payload,
        protocol: this.protocol,
        metadata: {
          backendRef: {
            provider: this.protocol,
            role: 'backend',
            sessionId: session.id,
            directory: this.directory,
            runId,
            messageId: payload?.info?.id || null,
          },
          ...(run.delegation
            ? {
                delegation: {
                  id: run.delegation.id,
                  sessionId: run.delegation.sessionId,
                  title: run.delegation.title,
                  directory: run.delegation.directory,
                },
              }
            : {}),
        },
      }
    } finally {
      deactivateBackend()
      clearTimeout(run.delegation?.turnTimer)
      if (
        run.delegation
        && this.delegatedRuns.get(run.delegation.id) === run
      ) {
        this.delegatedRuns.delete(run.delegation.id)
      }
      for (const record of this.pendingPermissions.values()) {
        if (
          record.onEvent === onEvent
          && record.status === 'pending'
        ) {
          record.status = 'expired'
          this.pendingPermissions.delete(record.id)
          this.permissionByRequest.delete(record.requestId)
        }
      }
      combinedSignal?.removeEventListener('abort', abortAll)
      if (delegatedAbortAttached) {
        signal?.removeEventListener('abort', abortAll)
      }
      await Promise.allSettled(abortPromises)
      stopObserving()
    }
  }

  async runCoordinator(message, {
    ownerId,
    coordinationRunId,
    signal,
    onEvent,
  } = {}) {
    const [session, backendAgent] = await Promise.all([
      this.ensureSession(ownerId),
      this.resolveBackendAgent(),
    ])
    let releaseCoordinator
    const released = new Promise(resolve => {
      releaseCoordinator = resolve
    })
    let lifecycle
    const initial = await this.serialize(session.id, async () => {
      lifecycle = this.executeCoordinatorRun(message, {
        session,
        backendAgent,
        ownerId,
        coordinationRunId,
        signal,
        onEvent,
        releaseCoordinator,
      })
      lifecycle.catch(() => {})
      return Promise.race([
        lifecycle.then(
          value => ({ completed: true, value }),
          error => ({ completed: true, error }),
        ),
        released.then(() => ({ completed: false })),
      ])
    })
    if (initial.completed) {
      if (initial.error) throw initial.error
      return initial.value
    }
    return lifecycle
  }
}
