import { managedOnlyBackend } from './shared.mjs'

export const qoderRuntimeDriver = {
  id: 'qoder',
  separateManagedProcess: false,

  resolve({ mode, permissionMode }) {
    return managedOnlyBackend({
      id: this.id,
      mode,
      permissionMode,
      label: 'Qoder',
    })
  },
}
