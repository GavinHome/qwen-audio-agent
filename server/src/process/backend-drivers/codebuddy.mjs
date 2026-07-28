import { managedOnlyBackend } from './shared.mjs'

export const codeBuddyRuntimeDriver = {
  id: 'codebuddy',
  separateManagedProcess: false,

  resolve({ ownership, permissionMode }) {
    return managedOnlyBackend({
      id: this.id,
      ownership,
      permissionMode,
      label: 'CodeBuddy',
    })
  },
}
