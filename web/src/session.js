export function requestedSessionId(search) {
  const value = String(
    new URLSearchParams(search).get('session') || '',
  ).trim()
  return value && value.length <= 200 ? value : ''
}
