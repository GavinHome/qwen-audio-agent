import { managedOnlyBackend } from './shared.mjs'

export const hermesRuntimeDriver = {
  id: 'hermes',
  separateManagedProcess: false,

  resolve({ ownership, permissionMode }) {
    return managedOnlyBackend({
      id: this.id,
      ownership,
      permissionMode,
      label: 'Hermes',
    })
  },
}
