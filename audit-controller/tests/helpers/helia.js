import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import * as raw from 'multiformats/codecs/raw'

/**
 * Minimal Helia stub — stores bytes in memory, returns a deterministic CID.
 * Matches the subset of the Helia API used in audit.js:
 *   heliaFs.addBytes(buf)    → CID
 *   helia.blockstore.put(cid, bytes)
 */
export function createHeliaStub() {
  const blocks = new Map()   // CID string → Uint8Array

  const heliaFs = {
    async addBytes(buf) {
      const hash = await sha256.digest(buf)
      const cid  = CID.create(1, raw.code, hash)
      blocks.set(cid.toString(), buf)
      return cid
    }
  }

  const helia = {
    blockstore: {
      async put(cid, bytes) { blocks.set(cid.toString(), bytes) },
      async get(cid)        { return blocks.get(cid.toString()) },
    },
    _blocks: blocks,
  }

  return { helia, heliaFs }
}