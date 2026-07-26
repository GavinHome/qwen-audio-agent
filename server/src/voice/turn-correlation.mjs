export class TurnCorrelation {
  constructor({ maxItems = 100 } = {}) {
    this.maxItems = maxItems
    this.turns = new Map()
    this.invalidItems = new Set()
  }

  remember(itemId, context) {
    if (!itemId) return
    this.turns.set(itemId, context)
    while (this.turns.size > this.maxItems) {
      const oldest = this.turns.keys().next().value
      this.turns.delete(oldest)
      this.invalidItems.delete(oldest)
    }
  }

  resolve(itemId, fallback) {
    return this.turns.get(itemId) || fallback
  }

  invalidate(itemId) {
    if (itemId) this.invalidItems.add(itemId)
  }

  isInvalid(itemId) {
    return this.invalidItems.has(itemId)
  }

  complete(itemId, fallback) {
    const context = this.resolve(itemId, fallback)
    const invalid = this.invalidItems.delete(itemId)
    this.turns.delete(itemId)
    return { context, invalid }
  }

  clear() {
    this.turns.clear()
    this.invalidItems.clear()
  }
}
