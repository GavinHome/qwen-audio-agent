import { managedOnlyBackend } from './shared.mjs'

export const hermesRuntimeDriver = {
  id: 'hermes',
  separateManagedProcess: false,

  resolve({ mode, permissionMode }) {
    return managedOnlyBackend({
      id: this.id,
      mode,
      permissionMode,
      label: 'Hermes',
    })
  },
}
