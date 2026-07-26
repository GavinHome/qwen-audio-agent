export class AgentError extends Error {
  constructor(message, { status = 0, body = '', protocol = '' } = {}) {
    super(message)
    this.name = 'AgentError'
    this.status = status
    this.body = body
    this.protocol = protocol
  }
}

export function requestSignal(signal, timeoutMs) {
  if (!timeoutMs) return signal
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export function backendEndpoint(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${path}`
}

export async function responseError(response, protocol) {
  const body = await response.text().catch(() => '')
  let message = body
  try {
    const parsed = JSON.parse(body)
    message = parsed.error?.message || parsed.error || parsed.detail || body
  } catch {
    // Raw text is still useful when OpenCode does not return JSON.
  }
  return new AgentError(
    `后台请求失败 (${response.status})${message ? `：${message}` : ''}`,
    { status: response.status, body, protocol },
  )
}

export class BackendAdapter {
  constructor({ fetchImpl, baseUrl, model, timeoutMs }) {
    this.fetch = fetchImpl
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '')
    this.model = model
    this.timeoutMs = timeoutMs
  }

  async request(path, {
    method = 'POST',
    body,
    headers,
    signal,
    timeoutMs = this.timeoutMs,
  } = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: requestSignal(signal, timeoutMs),
    })
    if (!response.ok) throw await responseError(response, this.protocol)
    return response
  }
}
