import { managedOnlyBackend } from './shared.mjs'

export const codexRuntimeDriver = {
  id: 'codex',
  separateManagedProcess: false,

  resolve({ mode, permissionMode }) {
    return managedOnlyBackend({
      id: this.id,
      mode,
      permissionMode,
      label: 'Codex',
    })
  },
}
