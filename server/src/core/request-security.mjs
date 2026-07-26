import { config } from './config.mjs'

function normalizedOrigin(value) {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

export function isAllowedOrigin(req) {
  const origin = normalizedOrigin(req.headers.origin)
  if (!origin) return true
  if (config.allowedOrigins.includes(origin)) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function enforceSameOrigin(req, res, next) {
  if (!isAllowedOrigin(req)) {
    res.status(403).json({ error: 'origin not allowed' })
    return
  }
  next()
}
