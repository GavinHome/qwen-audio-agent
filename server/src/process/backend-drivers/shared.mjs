export function origin(value) {
  return new URL(value).origin
}

export function localManagedBackend({
  id,
  env,
  ownership,
  permissionMode,
  baseUrlEnvironment,
  defaultBaseUrl,
}) {
  return {
    protocol: id,
    ownership,
    permissionMode,
    baseUrl: origin(env[baseUrlEnvironment] || defaultBaseUrl),
  }
}

export function managedOnlyBackend({
  id,
  ownership,
  permissionMode,
  label,
}) {
  if (ownership !== 'owned') {
    throw new Error(`${label} 后台必须由 Gateway 启动`)
  }
  return {
    protocol: id,
    ownership,
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
