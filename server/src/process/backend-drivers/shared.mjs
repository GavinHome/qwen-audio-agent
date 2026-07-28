export function origin(value) {
  return new URL(value).origin
}

export function localManagedBackend({
  id,
  env,
  mode,
  permissionMode,
  baseUrlEnvironment,
  defaultBaseUrl,
}) {
  return {
    protocol: id,
    mode,
    permissionMode,
    baseUrl: origin(env[baseUrlEnvironment] || defaultBaseUrl),
  }
}

export function managedOnlyBackend({
  id,
  mode,
  permissionMode,
  label,
}) {
  if (mode !== 'managed') {
    throw new Error(`${label} 后台当前只支持 managed 模式`)
  }
  return {
    protocol: id,
    mode,
    permissionMode,
    baseUrl: null,
  }
}

export function applyLocalAddress(env, backend, {
  baseUrlEnvironment,
  portEnvironment,
}) {
  const target = new URL(backend.baseUrl)
  env[baseUrlEnvironment] = backend.baseUrl
  env[portEnvironment] = target.port
    || (target.protocol === 'https:' ? '443' : '80')
}
