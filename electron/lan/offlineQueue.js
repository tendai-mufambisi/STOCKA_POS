const fs = require('fs')
const crypto = require('crypto')

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

  enqueue(channel, args) {
    const item = { id: crypto.randomUUID(), channel, args, timestamp: Date.now() }
    this.queue.push(item)
    this._save()
    return item.id
  }

  size() { return this.queue.length }

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

module.exports = { OfflineQueue }
