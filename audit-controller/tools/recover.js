import fs from 'fs'
import readline from 'readline'
import { deriveEntryId } from './strings.js'
import { getLogger } from './instrumentation.js'

const ORPHAN_LOG = './orphan-txs.log'
const RECOVERED_LOG = './orphan-txs.recovered.log'

export const recoverOrphanTxs = async (db) => {
  if (!fs.existsSync(ORPHAN_LOG)) return

  const log = getLogger()

  const rl = readline.createInterface({
    input: fs.createReadStream(ORPHAN_LOG),
    crlfDelay: Infinity
  })

  const recovered = []
  const failed = []

  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const { tx_hash, packet_hash, packet, block_height, timestamp } = JSON.parse(line)
      const entryId = deriveEntryId(packet)

      const existing = await db.get(entryId).catch(() => null)
      if (existing) {
        recovered.push({ tx_hash, reason: 'already exists' })
        continue
      }

      await db.put({
        _id: entryId,
        packet,
        packet_hash,
        tx_hash,
        timestamp: new Date(timestamp).toISOString(),
        recovered: true
      })
      recovered.push({ tx_hash, entryId })
    } catch (err) {
      log.error({
        event: 'orphan_tx.recover_entry_failed',
        entry_id: entryId, error: err.message
      })
      failed.push({ line, error: err.message })
    }
  }

  if (recovered.length > 0) {
    fs.appendFileSync(RECOVERED_LOG,
      recovered.map(r => JSON.stringify(r)).join('\n') + '\n'
    )
    log.info({ event: 'orphan_tx.recovered', count: recovered.length })
  }

  if (failed.length > 0) {
    fs.writeFileSync(ORPHAN_LOG,
      failed.map(f => f.line).join('\n') + '\n'
    )
    log.warn({ event: 'orphan_tx.still_pending', count: failed.length })
  } else {
    fs.writeFileSync(ORPHAN_LOG, '')
  }
}