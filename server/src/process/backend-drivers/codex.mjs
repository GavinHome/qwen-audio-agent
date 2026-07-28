import { managedOnlyBackend } from './shared.mjs'

export const codexRuntimeDriver = {
  id: 'codex',
  separateManagedProcess: false,

  resolve({ ownership, permissionMode }) {
    return managedOnlyBackend({
      id: this.id,
      ownership,
      permissionMode,
      label: 'Codex',
    })
  },
}
