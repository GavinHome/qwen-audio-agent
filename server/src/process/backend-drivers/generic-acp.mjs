import { managedOnlyBackend } from './shared.mjs'

export const genericAcpRuntimeDriver = {
  id: 'acp',
  separateManagedProcess: false,

  resolve({ ownership, permissionMode }) {
    if (permissionMode === 'full') {
      throw new Error('通用 ACP 后端无法安全地统一开启最高权限模式')
    }
    return managedOnlyBackend({
      id: this.id,
      ownership,
      permissionMode,
      label: 'ACP Agent',
    })
  },
}
