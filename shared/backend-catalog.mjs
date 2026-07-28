const definitions = new Map([
  ['opencode', {
    id: 'opencode',
    label: 'OpenCode',
    baseUrlEnvironment: 'OPENCODE_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:4096',
    supportsCompatible: true,
    supportsFullPermission: true,
  }],
  ['openclaw', {
    id: 'openclaw',
    label: 'OpenClaw',
    baseUrlEnvironment: 'OPENCLAW_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:18789',
    supportsCompatible: true,
    supportsFullPermission: false,
  }],
  ['qoder', {
    id: 'qoder',
    label: 'Qoder',
    supportsCompatible: false,
    supportsFullPermission: true,
  }],
  ['acp', {
    id: 'acp',
    label: 'ACP Agent',
    supportsCompatible: false,
    supportsFullPermission: false,
  }],
])

export function backendDefinition(protocol) {
  return definitions.get(String(protocol || '').trim().toLowerCase()) || null
}

export function backendNames() {
  return [...definitions.keys()]
}
