import { managedOnlyBackend } from './shared.mjs'

export const codeBuddyRuntimeDriver = {
  id: 'codebuddy',
  separateManagedProcess: false,

  resolve({ mode, permissionMode }) {
    return managedOnlyBackend({
      id: this.id,
      mode,
      permissionMode,
      label: 'CodeBuddy',
    })
  },
}
