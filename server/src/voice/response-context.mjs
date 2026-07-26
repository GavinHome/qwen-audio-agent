function pendingTranscripts(value) {
  return Array.isArray(value) ? value : []
}

export function ensureResponseContext(contexts, id, fallback = {}) {
  const existing = contexts.get(id)
  if (existing) {
    existing.pendingTranscripts = pendingTranscripts(existing.pendingTranscripts)
    return existing
  }

  const context = {
    turnId: '',
    taskId: null,
    origin: 'model',
    turnGeneration: -1,
    playbackStarted: false,
    playbackEnded: false,
    responseDone: false,
    transcriptDone: false,
    ...fallback,
    pendingTranscripts: pendingTranscripts(fallback.pendingTranscripts),
  }
  contexts.set(id, context)
  return context
}

export function mergeResponseContext(contexts, id, authoritative = {}) {
  const existing = ensureResponseContext(contexts, id)
  const context = {
    ...existing,
    ...authoritative,
    playbackStarted: existing.playbackStarted,
    playbackEnded: existing.playbackEnded,
    responseDone: existing.responseDone,
    transcriptDone: existing.transcriptDone,
    pendingTranscripts: existing.pendingTranscripts,
  }
  contexts.set(id, context)
  return context
}
