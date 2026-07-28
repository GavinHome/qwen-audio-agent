import { managedOnlyBackend } from './shared.mjs'

export const qoderRuntimeDriver = {
  id: 'qoder',
  separateManagedProcess: false,

  resolve({ ownership, permissionMode }) {
    return managedOnlyBackend({
      id: this.id,
      ownership,
      permissionMode,
      label: 'Qoder',
    })
  },
}
