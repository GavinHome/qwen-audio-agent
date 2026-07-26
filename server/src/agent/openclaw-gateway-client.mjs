import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { AgentError, requestSignal } from './backend-adapter.mjs'

function gatewayWebSocketUrl(baseUrl) {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function messageText(data) {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function assistantText(message) {
  if (Array.isArray(message?.content)) {
    return message.content
      .filter(part => part?.type === 'text')
      .map(part => part.text || '')
      .join('\n')
      .trim()
  }
  return String(message?.content || '').trim()
}

export class OpenClawGatewayClient {
  constructor({
    baseUrl,
    token = '',
    timeoutMs = 300000,
    WebSocketImpl = WebSocket,
  }) {
    this.url = gatewayWebSocketUrl(baseUrl)
    this.token = token
    this.timeoutMs = timeoutMs
    this.WebSocket = WebSocketImpl
  }

  call(method, params = {}, {
    signal,
    timeoutMs = this.timeoutMs,
    onEvent,
    keepAlive = false,
  } = {}) {
    const combinedSignal = requestSignal(signal, timeoutMs)
    return new Promise((resolve, reject) => {
      const ws = new this.WebSocket(this.url)
      const pending = new Map()
      let connected = false
      let finished = false

      const close = () => {
        if (
          ws.readyState === this.WebSocket.OPEN
          || ws.readyState === this.WebSocket.CONNECTING
        ) ws.close()
      }
      const finish = (error, value) => {
        if (finished) return
        finished = true
        combinedSignal?.removeEventListener('abort', abort)
        close()
        if (error) reject(error)
        else resolve(value)
      }
      const request = (requestMethod, requestParams) => {
        const id = randomUUID()
        pending.set(id, requestMethod)
        ws.send(JSON.stringify({
          type: 'req',
          id,
          method: requestMethod,
          params: requestParams,
        }))
      }
      const release = () => {
        combinedSignal?.removeEventListener('abort', abort)
        close()
      }
      const abort = () => {
        if (finished) {
          release()
          return
        }
        finish(combinedSignal.reason || new Error('OpenClaw Gateway 请求已取消'))
      }

      combinedSignal?.addEventListener('abort', abort, { once: true })
      if (combinedSignal?.aborted) return abort()

      ws.on('message', data => {
        let frame
        try {
          frame = JSON.parse(messageText(data))
        } catch {
          return
        }
        if (frame.type === 'event') {
          if (frame.event === 'connect.challenge' && !connected) {
            connected = true
            request('connect', {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'gateway-client',
                displayName: 'qwen-audio-agent',
                version: '0.1.0',
                platform: process.platform,
                mode: 'backend',
              },
              caps: ['tool-events'],
              role: 'operator',
              scopes: ['operator.read', 'operator.write'],
              ...(this.token ? { auth: { token: this.token } } : {}),
            })
          } else {
            onEvent?.(frame)
          }
          return
        }
        if (frame.type !== 'res' || !pending.has(frame.id)) return
        const requestMethod = pending.get(frame.id)
        pending.delete(frame.id)
        if (!frame.ok) {
          return finish(new AgentError(
            `OpenClaw Gateway ${requestMethod} 失败：${
              frame.error?.message || '未知错误'
            }`,
            {
              body: JSON.stringify(frame.error || {}),
              protocol: 'openclaw-gateway',
            },
          ))
        }
        if (requestMethod === 'connect') {
          request(method, params)
          return
        }
        if (keepAlive) {
          finished = true
          resolve({ payload: frame.payload, close: release })
          return
        }
        finish(null, frame.payload)
      })
      ws.once('error', error => finish(new AgentError(
        `无法连接 OpenClaw Gateway：${error.message}`,
        { protocol: 'openclaw-gateway' },
      )))
      ws.once('close', () => {
        if (!finished) finish(new AgentError(
          'OpenClaw Gateway 连接意外关闭',
          { protocol: 'openclaw-gateway' },
        ))
      })
    })
  }

  async sendAndWait(sessionKey, message, {
    signal,
    timeoutMs = this.timeoutMs,
    runId = randomUUID(),
    onEvent,
  } = {}) {
    const startedAt = Date.now()
    let activeRunId = String(runId)
    const forwardRunEvent = frame => {
      if (frame.event === 'agent' && frame.payload?.runId === activeRunId) {
        onEvent?.(frame.payload)
      }
    }
    const live = await this.call('chat.send', {
      sessionKey,
      message: String(message),
      idempotencyKey: runId,
      timeoutMs,
    }, {
      signal,
      onEvent: forwardRunEvent,
      keepAlive: true,
    })
    activeRunId = String(live.payload?.runId || runId)
    let completion
    try {
      completion = await this.call('agent.wait', {
        runId: activeRunId,
        timeoutMs,
      }, {
        signal,
        timeoutMs: timeoutMs + 5000,
        onEvent: forwardRunEvent,
      })
    } finally {
      live.close()
    }
    if (completion?.status === 'timeout') {
      throw new AgentError('等待 OpenClaw 回复超时', {
        protocol: 'openclaw-gateway',
      })
    }
    if (!['ok', 'completed'].includes(completion?.status)) {
      throw new AgentError(
        completion?.error || 'OpenClaw 执行失败',
        { protocol: 'openclaw-gateway' },
      )
    }
    const history = await this.call('chat.history', {
      sessionKey,
      limit: 20,
    }, { signal })
    const assistant = [...(history?.messages || [])].reverse().find(item => (
      item?.role === 'assistant'
      && Number(item?.timestamp || 0) >= startedAt - 1000
    ))
    const content = assistantText(assistant)
    if (!content) {
      throw new AgentError('OpenClaw 已完成，但没有返回文本', {
        protocol: 'openclaw-gateway',
      })
    }
    return { content, runId: activeRunId, raw: assistant }
  }

  listAgents(options = {}) {
    return this.call('agents.list', {}, {
      signal: options.signal,
      timeoutMs: options.timeoutMs || 5000,
    })
  }
}
