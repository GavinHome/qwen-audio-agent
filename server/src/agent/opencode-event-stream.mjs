import { backendEndpoint, responseError } from './backend-adapter.mjs'

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason || new Error('aborted'))
    }
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function nestedValue(value, keys) {
  if (!value || typeof value !== 'object') return null
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key]
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = nestedValue(child, keys)
    if (found !== null) return found
  }
  return null
}

export function normalizeOpenCodeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const payload = raw.payload && typeof raw.payload === 'object'
    ? raw.payload
    : raw
  const type = String(payload.type || '')
  if (!type) return null
  return {
    type,
    directory: raw.directory ? String(raw.directory) : null,
    project: raw.project || null,
    sessionId: String(
      nestedValue(payload, ['sessionID', 'sessionId']) || '',
    ) || null,
    payload,
    raw,
  }
}

export async function * sseJsonEvents(body) {
  if (!body) return
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n')
    let boundary
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        yield JSON.parse(data)
      } catch {
        // Ignore malformed events. The next complete SSE frame can still be used.
      }
    }
  }
}

export class OpenCodeEventStream {
  constructor({
    fetchImpl,
    baseUrl,
    headers,
    reconnectMs = 1000,
  }) {
    this.fetch = fetchImpl
    this.url = backendEndpoint(baseUrl, '/global/event')
    this.headers = headers
    this.reconnectMs = reconnectMs
    this.subscribers = new Set()
    this.controller = null
    this.running = null
    this.connected = false
    this.connectedAt = null
    this.lastEventAt = null
    this.lastDisconnectAt = null
  }

  subscribe({ sessionId, directory, onEvent }) {
    const subscriber = {
      sessionId: String(sessionId || ''),
      directory: directory ? String(directory) : '',
      onEvent,
    }
    this.subscribers.add(subscriber)
    this.start()
    return () => {
      this.subscribers.delete(subscriber)
      if (!this.subscribers.size) this.controller?.abort()
    }
  }

  start() {
    if (this.running || !this.subscribers.size) return
    const controller = new AbortController()
    this.controller = controller
    this.running = this.run(controller.signal)
      .catch(() => {})
      .finally(() => {
        if (this.controller === controller) this.controller = null
        this.running = null
        if (this.subscribers.size) this.start()
      })
  }

  status() {
    return {
      running: Boolean(this.running),
      connected: this.connected,
      subscribers: this.subscribers.size,
      connectedAt: this.connectedAt,
      lastEventAt: this.lastEventAt,
      lastDisconnectAt: this.lastDisconnectAt,
    }
  }

  async ready(timeoutMs = 1000) {
    const deadline = Date.now() + Math.max(0, timeoutMs)
    while (!this.connected && this.running && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return this.connected
  }

  dispatch(raw) {
    const event = normalizeOpenCodeEvent(raw)
    if (!event?.sessionId) return
    for (const subscriber of this.subscribers) {
      if (subscriber.sessionId && subscriber.sessionId !== event.sessionId) continue
      if (
        subscriber.directory
        && event.directory
        && subscriber.directory !== event.directory
      ) continue
      try {
        subscriber.onEvent?.(event)
      } catch {
        // One consumer must not interrupt the shared OpenCode event stream.
      }
    }
  }

  async run(signal) {
    while (!signal.aborted && this.subscribers.size) {
      try {
        const response = await this.fetch(this.url, {
          method: 'GET',
          headers: {
            ...this.headers(),
            Accept: 'text/event-stream',
          },
          signal,
        })
        if (!response.ok) throw await responseError(response, 'opencode')
        this.connected = true
        this.connectedAt = this.connectedAt || Date.now()
        for await (const raw of sseJsonEvents(response.body)) {
          if (signal.aborted) return
          this.lastEventAt = Date.now()
          this.dispatch(raw)
        }
      } catch (error) {
        if (signal.aborted) return
      } finally {
        if (this.connected) this.lastDisconnectAt = Date.now()
        this.connected = false
        this.connectedAt = null
      }
      await abortableDelay(this.reconnectMs, signal)
    }
  }
}
