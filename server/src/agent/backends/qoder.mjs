import {
  baseEnvironment,
  clean,
} from './shared.mjs'

export const qoderBackendDriver = {
  id: 'qoder',
  label: 'Qoder',
  resolveOptions(options) {
    return {
      baseUrl: '',
      model: options.qoderModel,
      directory: options.qoderDirectory,
      configDirectory: options.qoderConfigDirectory,
      cliPath: options.qoderCliPath,
      coordinatorAgent: options.coordinatorAgent,
    }
  },

  createProfile({
    directory,
    cliPath,
    configDirectory,
    permissionMode,
    model,
  }) {
    return {
      label: this.label,
      command: cliPath || 'qodercli',
      args: [
        '--acp',
        ...(clean(model) && clean(model) !== 'auto'
          ? ['--model', clean(model)]
          : []),
        ...(permissionMode === 'full'
          ? ['--dangerously-skip-permissions']
          : []),
      ],
      cwd: directory,
      env: baseEnvironment(configDirectory),
      externalMcp: true,
      nativeDelegation: false,
      backendUi: false,
    }
  },

}
