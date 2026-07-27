import { randomUUID } from 'node:crypto'
import {
  accessTokenFromEnv,
  createSdkMcpServer,
  getSessionInfo,
  listSessions,
  qodercliAuth,
  query,
  renameSession,
  tagSession,
  tool,
} from '@qoder-ai/qoder-agent-sdk'
import { z } from 'zod'
import { AgentError, requestSignal } from './backend-adapter.mjs'
import { BACKEND_AGENT_INSTRUCTIONS } from './backend-agent-instructions.mjs'

const COORDINATOR_TITLE = 'qwen-audio-agent · Backend Agent'
const SESSION_TOOL_SERVER = 'qwen_audio_agent'
const SESSION_TOOL_PREFIX = `mcp__${SESSION_TOOL_SERVER}__`
const MAX_SESSION_RESULTS = 50
const QODER_COORDINATOR_INSTRUCTIONS = [
  'Use qwen_audio_agent session tools whenever a request belongs to a project Session.',
  'For presentation.inline, return either null or exactly an object with title, format, and content.',
  'Never return a bare string in presentation.inline.',
].join('\n')

function clean(value) {
  return String(value || '').trim()
}

function bounded(value, max = 300) {
  return clean(value)
    .replace(
      /((?:password|secret|api[_ -]?key|access[_ -]?token|credential)\s*[=:]\s*)\S+/gi,
      '$1[已隐藏]',
    )
    .replace(/\s+/g, ' ')
    .slice(0, max)
}

function coordinatorTag(ownerId) {
  return `qwen-audio-agent:${encodeURIComponent(
    String(ownerId || 'personal'),
  )}:backend`
}

function isCoordinatorSession(session) {
  return /^qwen-audio-agent:.*:backend$/.test(clean(session?.tag))
}

function toolCategory(name, input) {
  const hint = `${name || ''} ${JSON.stringify(input || {})}`.toLowerCase()
  if (/image|draw|canvas|图片|图像|绘图/.test(hint)) return 'image'
  if (/search|web|fetch|browser|搜索|查询/.test(hint)) return 'search'
  if (/read|glob|grep|list|读取|查找/.test(hint)) return 'read'
  if (/write|edit|patch|写入|修改/.test(hint)) return 'write'
  return 'run'
}

function assistantActivity(message) {
  if (message?.type !== 'assistant') return []
  return (message.message?.content || []).flatMap(block => {
    if (block?.type === 'tool_use') {
      return [{
        id: block.id || null,
        kind: 'tool',
        tool: block.name || 'tool',
        status: 'running',
        category: toolCategory(block.name, block.input),
        detail: bounded(
          block.input?.description
          || block.input?.query
          || block.input?.file_path
          || block.input?.path
          || '',
        ),
      }]
    }
    if (block?.type === 'text' && clean(block.text)) {
      return [{ id: block.id || null, kind: 'text', status: 'running' }]
    }
    return []
  })
}

function systemActivity(message) {
  if (message?.type !== 'system') return null
  if (message.subtype === 'task_started' || message.subtype === 'task_progress') {
    return {
      id: message.task_id || null,
      kind: 'tool',
      tool: message.last_tool_name || message.task_type || 'Agent',
      status: 'running',
      category: toolCategory(message.last_tool_name, message.description),
      detail: bounded(message.description || message.summary || ''),
    }
  }
  if (message.subtype === 'task_notification') {
    return {
      id: message.task_id || null,
      kind: 'tool',
      tool: 'Agent',
      status: message.status === 'completed' ? 'completed' : message.status,
      category: 'run',
      detail: bounded(message.summary || ''),
    }
  }
  return null
}

function sessionSummary(session) {
  return {
    session_id: clean(session?.sessionId),
    title: bounded(
      session?.customTitle || session?.summary || session?.firstPrompt,
      160,
    ),
    directory: clean(session?.cwd),
    branch: bounded(session?.gitBranch, 120),
    updated_at: Number(session?.lastModified || 0),
  }
}

function jsonToolResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  }
}

function normalizeCoordinatorContent(content) {
  const text = clean(content)
  const candidate = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
    || text
  try {
    const parsed = JSON.parse(candidate)
    const inline = parsed?.presentation?.inline
    if (typeof inline !== 'string') return text
    parsed.presentation.inline = clean(inline)
      ? {
          title: 'Qoder 结果',
          format: 'markdown',
          content: inline,
        }
      : null
    return JSON.stringify(parsed)
  } catch {
    return text
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export class QoderAdapter {
  protocol = 'qoder'

  constructor({
    sdk = {
      accessTokenFromEnv,
      createSdkMcpServer,
      getSessionInfo,
      listSessions,
      qodercliAuth,
      query,
      renameSession,
      tagSession,
      tool,
    },
    model = 'auto',
    mode = 'managed',
    permissionMode = 'native',
    timeoutMs = 300_000,
    directory = process.cwd(),
    configDirectory = '',
    cliPath = '',
    authMode = 'cli',
    tokenEnv = 'QODER_PERSONAL_ACCESS_TOKEN',
  } = {}) {
    this.sdk = sdk
    this.model = clean(model) || 'auto'
    this.mode = mode === 'managed' ? 'managed' : 'compatible'
    this.permissionMode = permissionMode === 'full' ? 'full' : 'native'
    this.timeoutMs = timeoutMs
    this.directory = directory
    this.configDirectory = clean(configDirectory)
    this.cliPath = clean(cliPath)
    this.authMode = authMode === 'token' ? 'token' : 'cli'
    this.tokenEnv = clean(tokenEnv) || 'QODER_PERSONAL_ACCESS_TOKEN'
    this.coordinatorSessions = new Map()
    this.coordinatorSessionPromises = new Map()
    this.sessionQueues = new Map()
    this.delegatedWorkRuns = new Map()
    this.pendingPermissions = new Map()
    this.activeQueries = new Map()
    this.lastHealth = null
  }

  get label() {
    return 'Qoder'
  }

  describe() {
    return {
      kind: this.protocol,
      label: this.label,
      baseUrl: null,
      uiPath: null,
      model: this.model,
      directory: this.directory,
      mode: this.mode,
      permissionMode: this.permissionMode,
      backendAgent: 'qwen-audio-agent-backend',
      sessionModel: 'one-persistent-backend-agent',
      capabilities: {
        delegation: true,
        permissions: true,
        backendUi: false,
        nativeSessionHistory: true,
      },
    }
  }

  environment() {
    return {
      ...process.env,
      ...(this.configDirectory
        ? { QODER_CONFIG_DIR: this.configDirectory }
        : {}),
    }
  }

  auth() {
    return this.authMode === 'token'
      ? this.sdk.accessTokenFromEnv(this.tokenEnv)
      : this.sdk.qodercliAuth()
  }

  queryOptions(overrides = {}) {
    return {
      auth: this.auth(),
      model: this.model,
      includePartialMessages: true,
      env: this.environment(),
      ...(this.permissionMode === 'full'
        ? {
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
          }
        : {}),
      ...(this.cliPath ? { pathToQoderCLIExecutable: this.cliPath } : {}),
      ...overrides,
    }
  }

  async health() {
    try {
      const previous = this.lastHealth
      const sessions = await this.sdk.listSessions({ limit: 1 })
      this.lastHealth = {
        ...(previous || {}),
        ok: true,
        checkedAt: Date.now(),
        sessionStoreReadable: Array.isArray(sessions),
      }
      return {
        ok: true,
        protocol: this.protocol,
        mode: this.mode,
        enhanced: true,
        sessionStoreReadable: true,
        authMode: this.authMode,
        lastRunOk: previous?.lastRunOk ?? null,
      }
    } catch (error) {
      return {
        ok: false,
        protocol: this.protocol,
        mode: this.mode,
        error: error.message,
      }
    }
  }

  serialize(key, operation) {
    const previous = this.sessionQueues.get(key) || Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    this.sessionQueues.set(key, current)
    return current.finally(() => {
      if (this.sessionQueues.get(key) === current) {
        this.sessionQueues.delete(key)
      }
    })
  }

  async ensureCoordinatorSession(ownerId) {
    const key = coordinatorTag(ownerId)
    if (this.coordinatorSessions.has(key)) {
      return this.coordinatorSessions.get(key)
    }
    if (this.coordinatorSessionPromises.has(key)) {
      return this.coordinatorSessionPromises.get(key)
    }
    const pending = this.sdk.listSessions({
      dir: this.directory,
      limit: MAX_SESSION_RESULTS,
    }).then(sessions => {
      const existing = sessions.find(session => session?.tag === key)
      const selected = existing || {
        sessionId: randomUUID(),
        cwd: this.directory,
        isNew: true,
      }
      this.coordinatorSessions.set(key, selected)
      return selected
    }).finally(() => this.coordinatorSessionPromises.delete(key))
    this.coordinatorSessionPromises.set(key, pending)
    return pending
  }

  async persistCoordinatorSession(session, ownerId) {
    if (!session?.isNew) return
    session.isNew = false
    await Promise.allSettled([
      this.sdk.renameSession?.(
        session.sessionId,
        COORDINATOR_TITLE,
        { dir: this.directory },
      ),
      this.sdk.tagSession?.(
        session.sessionId,
        coordinatorTag(ownerId),
        { dir: this.directory },
      ),
    ])
  }

  permissionCallback({
    ownerId,
    coordinationRunId,
    onEvent,
  }) {
    return (toolName, input, options = {}) => {
      if (clean(toolName).startsWith(SESSION_TOOL_PREFIX)) {
        return Promise.resolve({
          behavior: 'allow',
          updatedInput: input,
          toolUseID: options.toolUseID,
        })
      }
      const id = `auth_${randomUUID().replaceAll('-', '')}`
      const pending = deferred()
      const suggestions = Array.isArray(options.suggestions)
        ? options.suggestions
        : []
      const permission = {
        id,
        workId: coordinationRunId || null,
        status: 'pending',
        category: bounded(toolName, 80) || 'unknown',
        summary: [
          bounded(toolName, 80),
          bounded(
            input?.description
            || input?.command
            || input?.file_path
            || input?.path
            || input?.query
            || '',
          ),
        ].filter(Boolean).join('：'),
        patterns: suggestions.flatMap(update => (
          Array.isArray(update?.rules)
            ? update.rules.map(rule => bounded(
                rule?.ruleContent || rule?.toolName,
                160,
              )).filter(Boolean)
            : []
        )).slice(0, 20),
      }
      this.pendingPermissions.set(id, {
        ...permission,
        ownerId: clean(ownerId),
        toolName,
        input,
        toolUseID: options.toolUseID,
        coordinationRunId,
        suggestions,
        onEvent,
        pending,
      })
      onEvent?.({ type: 'backend.permission.requested', permission })
      options.signal?.addEventListener('abort', () => {
        if (!this.pendingPermissions.has(id)) return
        this.pendingPermissions.delete(id)
        pending.resolve({
          behavior: 'deny',
          message: 'Permission request was cancelled.',
          toolUseID: options.toolUseID,
        })
      }, { once: true })
      return pending.promise
    }
  }

  async respondPermission(id, decision, { ownerId } = {}) {
    const record = this.pendingPermissions.get(String(id))
    if (!record || record.ownerId !== clean(ownerId)) {
      throw new AgentError('权限请求不存在、已经失效或不属于当前用户', {
        protocol: this.protocol,
      })
    }
    this.pendingPermissions.delete(record.id)
    const approved = decision === 'always'
    record.status = approved ? 'approved' : 'denied'
    record.pending.resolve(approved
      ? {
          behavior: 'allow',
          updatedInput: record.input,
          toolUseID: record.toolUseID,
          decisionClassification: 'user_permanent',
          ...(record.suggestions.length
            ? { updatedPermissions: record.suggestions }
            : {}),
        }
      : {
          behavior: 'deny',
          message: 'Rejected by user.',
          toolUseID: record.toolUseID,
          decisionClassification: 'user_reject',
        })
    const permission = {
      id: record.id,
      workId: record.workId,
      status: record.status,
      category: record.category,
      summary: record.summary,
    }
    record.onEvent?.({ type: 'backend.permission.resolved', permission })
    return permission
  }

  sessionTools(run) {
    const launch = ({ sessionId, directory, prompt, title, resume }) => {
      if (run.delegation) {
        return jsonToolResult({
          status: 'rejected',
          error: 'This coordinator turn already delegated work.',
        }, true)
      }
      const delegationId = `qoder_run_${randomUUID()}`
      const controller = new AbortController()
      const record = {
        id: delegationId,
        sessionId,
        directory,
        title: bounded(title || prompt, 160) || 'Qoder 项目任务',
        ownerId: run.ownerId,
        workId: run.coordinationRunId,
        status: 'running',
        controller,
        result: null,
        error: null,
      }
      run.delegation = record
      this.delegatedWorkRuns.set(run.coordinationRunId, run)
      record.promise = this.serialize(`target:${sessionId}`, async () => {
        try {
          const result = await this.executeQuery(prompt, {
            cwd: directory,
            ...(resume ? { resume: sessionId } : { sessionId }),
            ownerId: run.ownerId,
            coordinationRunId: run.coordinationRunId,
            onEvent: run.onEvent,
            signal: controller.signal,
            role: 'project',
          })
          record.status = 'completed'
          record.result = result
          return {
            id: record.id,
            sessionId: result.sessionId || record.sessionId,
            directory: result.cwd || record.directory,
            title: record.title,
            content: result.content,
          }
        } catch (error) {
          record.status = controller.signal.aborted ? 'cancelled' : 'failed'
          record.error = error
          throw error
        }
      })
      record.promise.catch(() => {})
      return jsonToolResult({
        status: 'started',
        delegation_id: delegationId,
        session_id: sessionId,
        title: record.title,
        directory,
      })
    }

    return this.sdk.createSdkMcpServer({
      name: SESSION_TOOL_SERVER,
      version: '1.0.0',
      tools: [
        this.sdk.tool(
          'qwen_audio_agent_sessions_list',
          'List existing native Qoder project sessions. Use this to find the exact session when the user wants to continue an existing Qoder project or conversation.',
          {
            query: z.string().optional(),
            directory: z.string().optional(),
            limit: z.number().int().min(1).max(MAX_SESSION_RESULTS).optional(),
          },
          async ({ query: search, directory, limit }) => {
            const sessions = await this.sdk.listSessions({
              ...(clean(directory) ? { dir: clean(directory) } : {}),
              limit: limit || 20,
            })
            const needle = clean(search).toLowerCase()
            return jsonToolResult({
              sessions: sessions
                .filter(session => !isCoordinatorSession(session))
                .map(sessionSummary)
                .filter(session => !needle || [
                  session.title,
                  session.directory,
                  session.branch,
                ].join(' ').toLowerCase().includes(needle)),
            })
          },
          { annotations: { readOnlyHint: true } },
        ),
        this.sdk.tool(
          'qwen_audio_agent_session_start',
          'Start a new native Qoder project session asynchronously. Pass a natural user-facing task prompt; never pass qwen-audio-agent transport envelopes.',
          {
            prompt: z.string().min(1),
            directory: z.string().min(1),
            title: z.string().optional(),
          },
          async ({ prompt, directory, title }) => launch({
            sessionId: randomUUID(),
            directory: clean(directory),
            prompt: clean(prompt),
            title,
            resume: false,
          }),
        ),
        this.sdk.tool(
          'qwen_audio_agent_session_send',
          'Continue an existing native Qoder session asynchronously. Use the exact session_id returned by sessions_list and a natural task prompt.',
          {
            session_id: z.string().min(1),
            prompt: z.string().min(1),
          },
          async ({ session_id: sessionId, prompt }) => {
            const session = await this.sdk.getSessionInfo(sessionId)
            if (!session?.sessionId || !session.cwd) {
              return jsonToolResult({
                status: 'not_found',
                error: 'Qoder session was not found.',
              }, true)
            }
            return launch({
              sessionId: session.sessionId,
              directory: session.cwd,
              prompt: clean(prompt),
              title: clean(prompt),
              resume: true,
            })
          },
        ),
        this.sdk.tool(
          'qwen_audio_agent_session_status',
          'Read the status of a Qoder project run previously started by this coordinator.',
          { delegation_id: z.string().min(1) },
          async ({ delegation_id: delegationId }) => {
            const record = [...this.delegatedWorkRuns.values()]
              .map(item => item.delegation)
              .find(item => item?.id === delegationId)
            return jsonToolResult(record
              ? {
                  status: record.status,
                  delegation_id: record.id,
                  session_id: record.sessionId,
                  title: record.title,
                }
              : { status: 'not_found' })
          },
          { annotations: { readOnlyHint: true } },
        ),
        this.sdk.tool(
          'qwen_audio_agent_session_cancel',
          'Cancel a Qoder project run previously started by this coordinator.',
          { delegation_id: z.string().min(1) },
          async ({ delegation_id: delegationId }) => {
            const record = [...this.delegatedWorkRuns.values()]
              .map(item => item.delegation)
              .find(item => item?.id === delegationId)
            if (!record) return jsonToolResult({ status: 'not_found' })
            record.controller.abort(new Error('用户已取消这项 Qoder 任务'))
            return jsonToolResult({
              status: 'cancelled',
              delegation_id: record.id,
              session_id: record.sessionId,
            })
          },
        ),
      ],
    })
  }

  async executeQuery(prompt, {
    cwd,
    sessionId,
    resume,
    ownerId,
    coordinationRunId,
    onEvent,
    signal,
    role,
    mcpServers,
    systemPrompt,
  }) {
    const controller = new AbortController()
    const combined = requestSignal(
      signal,
      role === 'project' ? 0 : this.timeoutMs,
    )
    const abort = () => controller.abort(
      combined?.reason || new Error('Qoder request was cancelled'),
    )
    combined?.addEventListener('abort', abort, { once: true })
    if (combined?.aborted) abort()
    const q = this.sdk.query({
      prompt,
      options: this.queryOptions({
        cwd,
        ...(resume ? { resume } : { sessionId }),
        abortController: controller,
        ...(this.permissionMode === 'full'
          ? {}
          : {
              canUseTool: this.permissionCallback({
                ownerId,
                coordinationRunId,
                onEvent,
              }),
            }),
        ...(mcpServers ? { mcpServers } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(mcpServers
          ? { allowedTools: [`${SESSION_TOOL_PREFIX}*`] }
          : {}),
      }),
    })
    const queryKey = `${role}:${sessionId || resume || randomUUID()}`
    this.activeQueries.set(queryKey, { q, controller })
    let result = null
    let resolvedSessionId = sessionId || resume || ''
    let resolvedCwd = cwd
    try {
      for await (const message of q) {
        if (message?.session_id) resolvedSessionId = message.session_id
        if (message?.type === 'system' && message.subtype === 'init') {
          resolvedCwd = message.cwd || resolvedCwd
        }
        for (const activity of assistantActivity(message)) {
          onEvent?.({ type: 'backend.activity', activity })
        }
        const activity = systemActivity(message)
        if (activity) onEvent?.({ type: 'backend.activity', activity })
        if (message?.type === 'result') result = message
      }
      if (!result || result.subtype !== 'success' || result.is_error) {
        throw new AgentError(
          `Qoder 执行失败：${
            result?.errors?.join('；')
            || result?.terminal_reason
            || result?.subtype
            || '没有返回最终结果'
          }`,
          { body: JSON.stringify(result || {}), protocol: this.protocol },
        )
      }
      this.lastHealth = {
        ...(this.lastHealth || {}),
        lastRunOk: true,
        lastRunAt: Date.now(),
      }
      return {
        content: role === 'coordinator'
          ? normalizeCoordinatorContent(result.structured_output
            ? JSON.stringify(result.structured_output)
            : result.result)
          : clean(result.structured_output
          ? JSON.stringify(result.structured_output)
          : result.result),
        sessionId: resolvedSessionId,
        cwd: resolvedCwd,
        raw: result,
      }
    } catch (error) {
      this.lastHealth = {
        ...(this.lastHealth || {}),
        lastRunOk: false,
        lastRunAt: Date.now(),
        lastError: error.message,
      }
      throw error
    } finally {
      combined?.removeEventListener('abort', abort)
      this.activeQueries.delete(queryKey)
      await q.close?.().catch(() => {})
      for (const [id, record] of this.pendingPermissions) {
        if (record.coordinationRunId === coordinationRunId) {
          this.pendingPermissions.delete(id)
          record.pending.resolve({
            behavior: 'deny',
            message: 'The Qoder turn has finished.',
            toolUseID: record.toolUseID,
          })
        }
      }
    }
  }

  delegationResultPrompt(result, coordinationRunId) {
    return [
      '<qwen_audio_agent_delegation_result>',
      JSON.stringify({
        request_id: clean(coordinationRunId),
        delegation_id: result.id,
        target_session_id: result.sessionId,
        directory: result.directory,
        result: clean(result.content).slice(0, 12_000),
      }, null, 2),
      '</qwen_audio_agent_delegation_result>',
      '这是已验证的目标 Qoder Session 最终结果。请整理并返回当前 request_id 的 completed 最终 presentation，不要再次执行或查询目标任务。',
    ].join('\n')
  }

  async coordinatorTurn(prompt, {
    session,
    ownerId,
    coordinationRunId,
    signal,
    onEvent,
  }) {
    const run = {
      ownerId: clean(ownerId),
      coordinationRunId: clean(coordinationRunId),
      onEvent,
      delegation: null,
    }
    const execute = () => this.executeQuery(prompt, {
      cwd: this.directory,
      ...(session.isNew
        ? { sessionId: session.sessionId }
        : { resume: session.sessionId }),
      ownerId,
      coordinationRunId,
      onEvent,
      signal,
      role: 'coordinator',
      mcpServers: { [SESSION_TOOL_SERVER]: this.sessionTools(run) },
      systemPrompt: {
        type: 'preset',
        preset: 'qodercli',
        append: [
          BACKEND_AGENT_INSTRUCTIONS,
          QODER_COORDINATOR_INSTRUCTIONS,
        ].join('\n'),
      },
    })
    let result
    try {
      result = await execute()
    } catch (error) {
      const existing = session.isNew
        ? await this.sdk.getSessionInfo(session.sessionId).catch(() => null)
        : null
      if (existing?.sessionId) {
        await this.persistCoordinatorSession(session, ownerId)
      }
      if (
        !existing?.sessionId
        || !/\bcode 42\b/i.test(String(error?.message || error))
      ) {
        throw error
      }
      result = await execute()
    }
    session.sessionId = result.sessionId || session.sessionId
    await this.persistCoordinatorSession(session, ownerId)
    return { run, result }
  }

  async runCoordinator(message, {
    ownerId,
    coordinationRunId,
    signal,
    onEvent,
  } = {}) {
    const session = await this.ensureCoordinatorSession(ownerId)
    const initial = await this.serialize(
      `coordinator:${session.sessionId}`,
      () => this.coordinatorTurn(message, {
        session,
        ownerId,
        coordinationRunId,
        signal,
        onEvent,
      }),
    )
    if (!initial.run.delegation) {
      return {
        content: initial.result.content,
        raw: initial.result.raw,
        protocol: this.protocol,
        metadata: {
          backendRef: {
            provider: this.protocol,
            role: 'backend',
            sessionId: session.sessionId,
            directory: this.directory,
          },
        },
      }
    }
    const delegation = initial.run.delegation
    onEvent?.({
      type: 'backend.delegated',
      delegation: {
        id: delegation.id,
        sessionId: delegation.sessionId,
        title: delegation.title,
        directory: delegation.directory,
        presentation: null,
      },
    })
    try {
      const target = await delegation.promise
      onEvent?.({
        type: 'backend.delegation.completed',
        delegation: {
          id: target.id,
          sessionId: target.sessionId,
          title: target.title,
          directory: target.directory,
        },
      })
      const final = await this.serialize(
        `coordinator:${session.sessionId}`,
        () => this.coordinatorTurn(
          this.delegationResultPrompt(target, coordinationRunId),
          {
            session,
            ownerId,
            coordinationRunId,
            signal,
            onEvent,
          },
        ),
      )
      return {
        content: final.result.content,
        raw: final.result.raw,
        protocol: this.protocol,
        metadata: {
          backendRef: {
            provider: this.protocol,
            role: 'backend',
            sessionId: session.sessionId,
            directory: this.directory,
          },
          delegation: {
            id: target.id,
            sessionId: target.sessionId,
            title: target.title,
            directory: target.directory,
          },
        },
      }
    } finally {
      this.delegatedWorkRuns.delete(clean(coordinationRunId))
    }
  }

  async cancelDelegatedWork(workId, { ownerId } = {}) {
    const run = this.delegatedWorkRuns.get(clean(workId))
    const record = run?.delegation
    if (!record || record.ownerId !== clean(ownerId)) {
      throw new AgentError('没有找到可取消的 Qoder 项目任务', {
        protocol: this.protocol,
      })
    }
    record.controller.abort(new Error('用户已取消这项 Qoder 项目任务'))
    record.status = 'cancelled'
    return {
      route: 'adapter',
      layer: 'delegated',
      delegationId: record.id,
      sessionId: record.sessionId,
    }
  }

  async queryDelegatedWork(workId, question, { ownerId } = {}) {
    const run = this.delegatedWorkRuns.get(clean(workId))
    const record = run?.delegation
    if (!record || record.ownerId !== clean(ownerId)) {
      throw new AgentError('没有找到对应的 Qoder 项目任务', {
        protocol: this.protocol,
      })
    }
    const detail = record.status === 'failed'
      ? `失败：${record.error?.message || '未知错误'}`
      : record.status === 'completed'
        ? '项目执行已经完成，正在整理最终结果。'
        : record.status === 'cancelled'
          ? '项目执行已经取消。'
          : '项目任务仍在执行。'
    return {
      content: JSON.stringify({
        work_id: clean(workId),
        state: 'completed',
        mode: 'respond',
        presentation: {
          speech: clean(question) ? `${detail}` : detail,
          inline: null,
        },
      }),
      protocol: this.protocol,
      metadata: {
        delegation: {
          id: record.id,
          sessionId: record.sessionId,
          title: record.title,
          directory: record.directory,
        },
      },
    }
  }

  async close() {
    for (const run of this.delegatedWorkRuns.values()) {
      run.delegation?.controller.abort(
        new Error('Qoder backend is shutting down'),
      )
    }
    const closing = []
    for (const { q, controller } of this.activeQueries.values()) {
      controller.abort(new Error('Qoder backend is shutting down'))
      if (q?.close) closing.push(q.close())
    }
    await Promise.allSettled(closing)
  }
}
