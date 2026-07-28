import { genericAcpBackendDriver } from './generic-acp.mjs'
import { openClawBackendDriver } from './openclaw.mjs'
import { openCodeBackendDriver } from './opencode.mjs'
import { qoderBackendDriver } from './qoder.mjs'

const drivers = new Map([
  openCodeBackendDriver,
  openClawBackendDriver,
  qoderBackendDriver,
  genericAcpBackendDriver,
].map(driver => [driver.id, driver]))

export function backendDriver(protocol) {
  const id = String(protocol || '').trim().toLowerCase()
  const driver = drivers.get(id)
  if (!driver) throw new Error(`不支持的后台 Agent：${id}`)
  return driver
}

export function hasBackendDriver(protocol) {
  return drivers.has(String(protocol || '').trim().toLowerCase())
}

export function backendIds() {
  return [...drivers.keys()]
}
