/**
 * Creates a fresh in-memory store that matches the OrbitDB KeyValueIndexed API
 * used in audit.js:  db.put(), db.get(), db.all()
 */
export function createInMemoryDB() {
  const store = new Map()

  return {
    async put(record) {
      store.set(record._id, record)
      // OrbitDB put() returns the entry hash — return a fake one
      return `fakehash-${record._id}`
    },

    async get(id) {
      const record = store.get(id)
      if (!record) return undefined
      // db.get() in audit.js accesses result.hash (for CID lookup)
      return { hash: `fakecid-${id}`, value: record }
    },

    async all() {
      // audit.js iterates: entries.filter(e => e.value._id ...)
      return Array.from(store.values()).map(record => ({
        value: record,
        hash: `fakecid-${record._id}`
      }))
    },

    // Test helper — not part of the real API
    _store: store,
    _reset() { store.clear() },
    _size()  { return store.size },
  }
}