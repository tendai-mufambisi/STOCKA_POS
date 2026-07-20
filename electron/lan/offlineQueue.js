const fs = require('fs')
const crypto = require('crypto')

// Channels that carry derived state, not business writes. lanClient drops these
// rather than enqueueing them; they are still counted out of the user-facing
// "pending" figure here so that queue files written before that fix don't report
// thousands of phantom pending records on the offline banner.
const NON_BUSINESS_CHANNELS = new Set([
  'domain:notifications:create',
  'domain:notifications:clearForProduct',
  'domain:notifications:markRead',
])

class OfflineQueue {
  constructor(queuePath) {
    this.path = queuePath
    this.queue = this._load()
  }

  _load() {
    try {
      if (fs.existsSync(this.path)) return JSON.parse(fs.readFileSync(this.path, 'utf8'))
    } catch (_) {}
    return []
  }

  _save() {
    const tmp = this.path + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.queue), 'utf8')
    fs.renameSync(tmp, this.path)
  }

  // Saves eagerly, on purpose. Only business writes (sales, shifts, stock) reach the
  // queue now that derived state is dropped upstream, and losing one of those to a
  // power cut is far worse than the cost of a write. The 1 MB-per-enqueue problem
  // came from the stock-alert flood, which is fixed at its source in lanClient.
  enqueue(channel, args) {
    const item = { id: crypto.randomUUID(), channel, args, timestamp: Date.now() }
    this.queue.push(item)
    this._save()
    return item.id
  }

  // Everything still on disk, including legacy derived-state entries.
  size() { return this.queue.length }

  // What a cashier would call "pending": real business writes only. This is the
  // number the offline banner shows.
  businessSize() { return this.queue.reduce((n, i) => n + (NON_BUSINESS_CHANNELS.has(i.channel) ? 0 : 1), 0) }

  peek() { return [...this.queue] }

  // Call handler(channel, args, queuedAtMs) for each item; removes item on success.
  // `queuedAtMs` is when the write was first enqueued — i.e. the real moment the
  // cashier acted — so the caller can replay it to Main with its true event time
  // instead of the (much later) replay time.
  // A handler error with `permanent = true` (the server rejected the write outright —
  // retrying can never succeed) ALSO removes the item, reported via `deadLettered`
  // so the caller can archive and surface it. Transient errors keep the item queued.
  // Returns { failed: [{item, error}], deadLettered: [{item, error}] }.
  async flush(handler) {
    const failed = []
    const deadLettered = []
    for (const item of [...this.queue]) {
      try {
        await handler(item.channel, item.args, item.timestamp)
        this.queue = this.queue.filter(q => q.id !== item.id)
        this._save()
      } catch (err) {
        if (err.permanent) {
          this.queue = this.queue.filter(q => q.id !== item.id)
          this._save()
          deadLettered.push({ item, error: err.message })
        } else {
          failed.push({ item, error: err.message })
        }
      }
    }
    return { failed, deadLettered }
  }

  clear() {
    this.queue = []
    this._save()
  }
}

module.exports = { OfflineQueue, NON_BUSINESS_CHANNELS }
