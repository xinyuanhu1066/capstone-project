import fs from 'fs'
import readline from 'readline'
import { deriveEntryId } from './strings.js'

const ORPHAN_LOG = './orphan-txs.log'
const RECOVERED_LOG = './orphan-txs.recovered.log'

export const recoverOrphanTxs = async (db) => {
  if (!fs.existsSync(ORPHAN_LOG)) return

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
        recovered.push({ txHash, reason: 'already exists' })
        continue
      }

      await db.put({
        _id: entryId,
        packet,
        packet_hash,
        tx_hash: txHash,
        timestamp: new Date(timestamp).toISOString(),
        recovered: true
      })
      recovered.push({ txHash, entryId })
    } catch (err) {
      failed.push({ line, error: err.message })
    }
  }

  if (recovered.length > 0) {
    fs.appendFileSync(RECOVERED_LOG,
      recovered.map(r => JSON.stringify(r)).join('\n') + '\n'
    )
    console.log(`[Recovery] Recovered ${recovered.length} orphan tx(s)`)
  }

  if (failed.length > 0) {
    fs.writeFileSync(ORPHAN_LOG,
      failed.map(f => f.line).join('\n') + '\n'
    )
    console.warn(`[Recovery] ${failed.length} orphan tx(s) still pending`)
  } else {
    fs.unlinkSync(ORPHAN_LOG)
  }
}