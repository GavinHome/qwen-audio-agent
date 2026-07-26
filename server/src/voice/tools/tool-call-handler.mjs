import {
  CANCEL_AGENT_TASK_TOOL_NAME,
  DELEGATE_TOOL_NAME,
  GET_CURRENT_TIME_TOOL_NAME,
  USER_MEMORY_TOOL_NAME,
} from '../realtime-provider.mjs'
import { currentTimeSnapshot } from '../../conversation/frontend-agent-context.mjs'

const SENSITIVE_MEMORY = /(?:pass(?:word)?|secret|api[_ -]?key|access[_ -]?token|credential|验证码|密码|密钥|令牌|\bsk-[a-z0-9_-]+)/i

function failure(errorCode, userMessage, {
  retryable = false,
  status = 'failed',
} = {}) {
  return {
    status,
    error: true,
    error_code: errorCode,
    user_message: userMessage,
    retryable,
  }
}

export class ToolCallHandler {
  constructor({
    taskManager,
    ownerId,
    sessionId,
    transcripts,
    getFrontend,
    getTurnId,
    getTurnGeneration,
    coordinator,
    coordinatorAvailable = async () => true,
    memoryStore,
    getClientContext = () => ({}),
    getConversationContext = () => [],
    onMemoryChanged = () => {},
  }) {
    this.taskManager = taskManager
    this.ownerId = ownerId
    this.sessionId = sessionId
    this.transcripts = transcripts
    this.getFrontend = getFrontend
    this.getTurnId = getTurnId
    this.getTurnGeneration = getTurnGeneration
    this.coordinator = coordinator
    this.coordinatorAvailable = coordinatorAvailable
    this.memoryStore = memoryStore
    this.getClientContext = getClientContext
    this.getConversationContext = getConversationContext
    this.onMemoryChanged = onMemoryChanged
    this.processedCalls = new Set()
    this.turnTasks = new Map()
  }

  isStale(turnId, generation) {
    return (
      generation !== this.getTurnGeneration()
      || Boolean(turnId && this.getTurnId() && turnId !== this.getTurnId())
    )
  }

  async sendOutput(callId, output, turnId, taskId, options) {
    await this.getFrontend()?.sendFunctionOutput(
      callId,
      output,
      { turnId, taskId },
      options,
    )
  }

  async closeStaleCall(callId, turnId) {
    await this.sendOutput(
      callId,
      {
        status: 'superseded',
        message: '用户已经开始了新一轮，这次尚未提交。',
      },
      turnId,
      null,
      { createResponse: false },
    )
  }

  createWork({ turnId, originalRequest, objective, submissionKey }) {
    let workId = ''
    const task = this.taskManager.create({
      objective: originalRequest,
      ownerId: this.ownerId,
      sessionId: this.sessionId,
      turnId,
      submissionKey,
      laneKey: `coordinator:${this.ownerId}`,
      laneLimit: 1,
      runner: async (_ignored, { onEvent, signal }) => this.coordinator.run({
        originalRequest,
        objective,
        conversationContext: this.getConversationContext(),
        userMemories: this.memoryStore?.list(this.ownerId) || [],
        timeZone: this.getClientContext()?.timeZone,
      }, {
        ownerId: this.ownerId,
        sessionId: this.sessionId,
        turnId,
        coordinationRunId: workId,
        signal,
        onEvent,
      }),
    })
    workId = task.id
    this.turnTasks.set(turnId, task.id)
    if (this.turnTasks.size > 100) {
      this.turnTasks.delete(this.turnTasks.keys().next().value)
    }
    return task
  }

  async handle(event, callContext = {}) {
    const callId = event.call_id || event.item?.call_id || ''
    const toolName = event.name || event.item?.name || ''
    if (!callId) throw new Error('Realtime 工具调用缺少 call_id')
    if (this.processedCalls.has(callId)) return
    this.processedCalls.add(callId)
    if (this.processedCalls.size > 500) {
      this.processedCalls.delete(this.processedCalls.values().next().value)
    }

    const turnId = callContext.turnId
      || event.__voiceContext?.turnId
      || this.getTurnId()
    const generation = Number.isInteger(callContext.turnGeneration)
      ? callContext.turnGeneration
      : Number.isInteger(event.__voiceContext?.turnGeneration)
        ? event.__voiceContext.turnGeneration
        : this.getTurnGeneration()
    let args = {}
    try {
      args = JSON.parse(event.arguments || '{}')
    } catch {
      // Invalid arguments are handled as missing fields below.
    }

    if (this.isStale(turnId, generation)) {
      await this.closeStaleCall(callId, turnId)
      return
    }

    if (toolName === GET_CURRENT_TIME_TOOL_NAME) {
      await this.getCurrentTime(callId, turnId)
      return
    }
    if (toolName === USER_MEMORY_TOOL_NAME) {
      await this.userMemory(callId, turnId, generation, args)
      return
    }
    if (toolName === CANCEL_AGENT_TASK_TOOL_NAME) {
      await this.cancelAgentTask(callId, turnId, args)
      return
    }
    if (toolName !== DELEGATE_TOOL_NAME) {
      await this.sendOutput(
        callId,
        failure('unsupported_tool', '当前无法执行这个操作。'),
        turnId,
      )
      return
    }

    const resolved = await this.transcripts.resolveDelegation(
      turnId,
      args.objective,
    )
    if (this.isStale(turnId, generation)) {
      await this.closeStaleCall(callId, turnId)
      return
    }
    const originalRequest = String(
      resolved.originalRequest || resolved.objective || '',
    ).trim()
    const objective = String(
      resolved.objective || resolved.originalRequest || '',
    ).trim()
    if (!objective) {
      await this.sendOutput(
        callId,
        failure(
          'missing_objective',
          '没有获得完整、可执行的目标，需要用户补充必要信息。',
          { retryable: true },
        ),
        turnId,
      )
      return
    }

    let coordinatorReady = false
    try {
      coordinatorReady = await this.coordinatorAvailable()
    } catch {
      coordinatorReady = false
    }
    if (!coordinatorReady) {
      await this.sendOutput(
        callId,
        failure(
          'backend_unavailable',
          '后台 Agent 当前未连接。可以继续语音交流，连接 OpenCode 或 OpenClaw 后再执行这项工作。',
          { retryable: true },
        ),
        turnId,
      )
      return
    }

    const existingId = this.turnTasks.get(turnId)
    if (existingId) {
      await this.sendOutput(
        callId,
        {
          status: 'duplicate',
          work_id: existingId,
          message: '这一轮已经提交，不要重复执行。',
        },
        turnId,
        existingId,
        { createResponse: false },
      )
      return
    }

    let task
    try {
      const submissionKey = [
        'delegation',
        this.sessionId,
        turnId || callId,
      ].join(':')
      task = this.createWork({
        turnId,
        originalRequest,
        objective,
        submissionKey,
      })
    } catch {
      await this.sendOutput(
        callId,
        failure(
          'work_submission_failed',
          '暂时没有成功提交这次请求，请稍后重试。',
          { retryable: true },
        ),
        turnId,
      )
      return
    }
    await this.sendOutput(
      callId,
      task.reused
        ? {
            status: 'duplicate',
            work_id: task.id,
            message: '这一轮已经提交，不要重复执行。',
          }
        : {
            status: 'accepted',
            marker: '[thinking]',
            work_id: task.id,
          },
      turnId,
      task.id,
      task.reused
        ? { createResponse: false }
        : {
            // Let Realtime decide whether the user still needs an acknowledgement,
            // based on what it already said before invoking the tool.
            response: {
              instructions: [
                '结合本轮调用工具前你已经对用户说过的内容，自主判断是否还需要回应。',
                '如果已经说明正在处理，不要重复或换一种说法再次确认。',
                '如果此前没有确认，可以用包含具体任务对象的短句确认；避免“好的、收到”等通用承接语。',
                'accepted 不代表已经完成。',
              ].join(' '),
            },
          },
    )
  }

  notifyMemoryChanged() {
    try {
      this.onMemoryChanged()
    } catch {
      // Persistence succeeded even if a live prompt refresh did not.
    }
  }

  async cancelAgentTask(callId, turnId, args) {
    const requestedId = String(args.work_id || '').trim()
    const targetId = requestedId || this.taskManager.list({
      ownerId: this.ownerId,
      sessionId: this.sessionId,
      active: true,
    })[0]?.id
    if (!targetId) {
      await this.sendOutput(callId, {
        status: 'not_found',
        message: '当前没有仍在排队或执行的工作。',
      }, turnId)
      return
    }
    const task = this.taskManager.cancel(targetId, {
      ownerId: this.ownerId,
    })
    if (!task) {
      await this.sendOutput(callId, {
        status: 'not_active',
        work_id: targetId,
        message: '这项工作已经结束，当前无法取消。',
      }, turnId)
      return
    }
    await this.sendOutput(callId, {
      status: 'cancelled',
      work_id: task.id,
      message: '已取消这项工作。',
    }, turnId, task.id)
  }

  async getCurrentTime(callId, turnId) {
    await this.sendOutput(callId, {
      status: 'ok',
      ...currentTimeSnapshot(this.getClientContext()),
    }, turnId)
  }

  async userMemory(callId, turnId, generation, args) {
    const action = String(args.action || '').trim().toLowerCase()
    const scope = String(args.scope || '').trim().toLowerCase()
    const content = String(args.content || '').trim()
    const query = String(args.query || '').trim()
    const memoryIds = Array.isArray(args.memory_ids)
      ? args.memory_ids.map(id => String(id || '').trim()).filter(Boolean).slice(0, 20)
      : []
    const all = args.all === true
    let output
    if (!this.memoryStore) {
      output = failure('memory_unavailable', '前台记忆功能当前不可用。')
    } else if (!['recall', 'remember', 'replace', 'forget'].includes(action)) {
      output = failure('invalid_memory_action', '没有识别出要执行的记忆操作。')
    } else if (!['profile', 'long_term', 'all'].includes(scope)) {
      output = failure('invalid_memory_scope', '没有识别出记忆范围。')
    } else if (action === 'recall') {
      const memories = this.memoryStore.list(this.ownerId, { scope, query })
      output = {
        status: memories.length ? 'ok' : 'not_found',
        count: memories.length,
        memories,
      }
    } else if (action === 'remember' || action === 'replace') {
      if (scope === 'all' || !content) {
        output = failure('missing_memory', '需要明确记忆类型和要记住的内容。')
      } else if (action === 'replace' && !memoryIds.length) {
        output = failure(
          'missing_memory_ids',
          '需要先找到要被新事实取代的旧记忆。',
          { retryable: true },
        )
      } else if (SENSITIVE_MEMORY.test(content)) {
        output = failure(
          'sensitive_memory',
          '为了安全，不会保存密码、密钥、验证码或令牌。',
          { status: 'rejected' },
        )
      } else {
        try {
          if (action === 'replace') {
            const result = this.memoryStore.replace(this.ownerId, {
              scope,
              ids: memoryIds,
              content,
            })
            output = {
              status: result.replaced ? 'replaced' : 'not_found',
              ...result,
            }
            if (result.replaced) this.notifyMemoryChanged()
          } else {
            output = {
              status: 'remembered',
              memory: this.memoryStore.remember(this.ownerId, { scope, content }),
            }
            this.notifyMemoryChanged()
          }
        } catch {
          output = failure(
            'memory_write_failed',
            '暂时无法保存这项记忆，请稍后再试。',
            { retryable: true },
          )
        }
      }
    } else {
      const transcript = await this.transcripts.transcript(turnId)
      if (this.isStale(turnId, generation)) {
        await this.closeStaleCall(callId, turnId)
        return
      }
      const explicit = /(?:忘|删除|清空|别再记|不要记|\bforget\b|\bdelete\b|\bclear\b)/i
        .test(transcript)
      const explicitAll = /(?:清空|全部.*(?:忘|删除)|(?:忘|删除).*全部|所有.*记忆|\bforget\s+all\b|\bclear\s+all\b)/i
        .test(transcript)
      if (!explicit) {
        output = failure(
          'explicit_consent_required',
          '没有听到明确的遗忘请求，因此没有删除记忆。',
          { status: 'rejected' },
        )
      } else if (all && !explicitAll) {
        output = failure(
          'clear_all_consent_required',
          '用户没有明确要求清空全部记忆，因此没有删除。',
          { status: 'rejected' },
        )
      } else if (!all && !query) {
        output = failure('missing_memory_query', '需要明确要遗忘的内容。')
      } else {
        try {
          const removed = this.memoryStore.forget(this.ownerId, {
            scope,
            query,
            all,
          })
          if (removed) this.notifyMemoryChanged()
          output = { status: removed ? 'forgotten' : 'not_found', removed }
        } catch {
          output = failure(
            'memory_write_failed',
            '暂时无法删除这项记忆，请稍后再试。',
            { retryable: true },
          )
        }
      }
    }
    await this.sendOutput(callId, output, turnId)
  }
}
