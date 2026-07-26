export class ActiveVoiceClients {
  constructor() {
    this.clients = new Map()
  }

  activate(ownerId, client, { takeover = false } = {}) {
    const key = String(ownerId || '')
    const previous = this.clients.get(key)
    if (previous === client) {
      return { granted: true, previous: null }
    }
    if (previous && !takeover) {
      return { granted: false, previous }
    }
    previous?.deactivate?.(client)
    this.clients.set(key, client)
    return { granted: true, previous: previous || null }
  }

  release(ownerId, client) {
    const key = String(ownerId || '')
    if (this.clients.get(key) !== client) return false
    this.clients.delete(key)
    return true
  }

  isActive(ownerId, client) {
    return this.clients.get(String(ownerId || '')) === client
  }

  active(ownerId) {
    return this.clients.get(String(ownerId || '')) || null
  }

  get size() {
    return this.clients.size
  }
}

export function clientVoiceCapabilities({
  voiceEnabled = false,
  textOnly = false,
} = {}) {
  const outputEnabled = voiceEnabled === true
  const participatesInVoiceArbitration = outputEnabled && textOnly !== true
  return {
    inputEnabled: participatesInVoiceArbitration,
    outputEnabled,
    participatesInVoiceArbitration,
  }
}
