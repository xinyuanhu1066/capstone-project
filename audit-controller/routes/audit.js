import express from 'express'
import { getDB } from '../services/orbitdb.js'

const router = express.Router()

// POST /audit/packet - Receive and store audit packet
router.post('/packet', async (req, res) => {
  try {
    const packet = req.body
    const db = getDB()

    if (!db) {
      return res.status(503).json({ error: 'Database not initialized' })
    }

    // 1. Store audit packet in OrbitDB
    const entry = {
      _id: packet.packet_hash,
      ...packet,
      timestamp: new Date().toISOString()
    }

    try {
      const hash = await db.put(entry)
      console.log(`[Audit Controller] Stored packet ${packet.packet_hash} | CID: ${hash}`)
      
      res.status(201).json({ 
        status: 'success', 
        cid: hash,
        packet_hash: packet.packet_hash 
      })
    } catch (dbError) {
      if (dbError.message.includes('NoPeersSubscribedToTopic')) {
        // This is common in single-node dev environments with some pubsub configs
        console.warn('[Audit Controller Warning] OrbitDB pubsub needs peers for full replication, but continuing with local storage...')
        
        // In some versions of OrbitDB/Helia, this error might be non-fatal for local storage
        // or might require specific configuration to bypass.
        // For prototype Phase 1, we will report it but try to ensure it doesn't break the SDK.
        res.status(500).json({ 
          error: 'OrbitDB PublishError: No peers subscribed to topic. Ensure at least one other node is connected if replication is required.',
          code: 'NO_PEERS'
        })
      } else {
        throw dbError
      }
    }

  } catch (error) {
    console.error('[Audit Controller Error] Failed to store packet:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /audit/packets - Retrieve all audit packets
router.get('/packets', async (req, res) => {
  try {
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    const packets = await db.all()
    res.json(packets)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
