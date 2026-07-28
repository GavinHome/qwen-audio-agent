import { resolve } from 'node:path'
import { baseEnvironment } from './shared.mjs'

export const openCodeBackendDriver = {
  id: 'opencode',
  label: 'OpenCode',
  resolveOptions(options) {
    return {
      baseUrl: options.baseUrl,
      model: options.model ?? options.openCodeModel,
      directory: options.directory,
      coordinatorAgent: options.coordinatorAgent,
    }
  },

  createProfile({ root, directory }) {
    return {
      label: this.label,
      command: resolve(root, 'scripts/opencode-acp'),
      args: [],
      cwd: directory,
      env: baseEnvironment(),
      externalMcp: true,
      nativeDelegation: false,
      backendUi: true,
      uiUrl({ baseUrl, sessionId }) {
        if (!baseUrl || !sessionId) return baseUrl
        const serverKey = Buffer.from(baseUrl).toString('base64url')
        return `${
          baseUrl
        }/server/${serverKey}/session/${encodeURIComponent(sessionId)}`
      },
    }
  },

}
