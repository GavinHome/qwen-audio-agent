export function resultLabel(message) {
  const title = String(message?.title || '').trim()
  return title || '执行结果'
}
