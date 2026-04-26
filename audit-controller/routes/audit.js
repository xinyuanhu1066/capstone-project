import express from 'express'
import { getDB } from '../services/orbitdb.js'
import { anchorToBlockchain, getRecordFromBlockchain } from '../services/blockchain.js'

const router = express.Router()

// POST /audit/packet - Receive and store audit packet
router.post('/packet', async (req, res) => {
  try {
    const packet = req.body
    const db = getDB()

    if (!db) {
      return res.status(503).json({ error: 'Database not initialized' })
    }

    // 1. Store the IMMUTABLE part in OrbitDB first to get the CID
    // We DO NOT include tx_hash here because it would change the CID later
    const auditEntry = {
      _id: packet.packet_hash,
      ...packet,
      timestamp: new Date().toISOString()
    }

    const cid = await db.put(auditEntry)
    console.log(`[Audit Controller] Audit stored | CID: ${cid}`)

    // 2. Anchor the resulting CID to the Ganache smart contract
    let txHash = 'N/A'
    try {
        txHash = await anchorToBlockchain(
            packet.step_id, 
            cid, // We anchor the CID of the record that actually contains the data
            packet.provenance.dataset_merkle_root
        )
        
        // 3. Store the TX hash as a SEPARATE metadata entry or property
        // To keep the CID valid for verification, we store a secondary mapping
        const metaEntry = {
            _id: `meta-${packet.packet_hash}`,
            packet_hash: packet.packet_hash,
            tx_hash: txHash,
            anchored_cid: cid
        }
        await db.put(metaEntry)
        console.log(`[Audit Controller] Meta stored | TX: ${txHash}`)

    } catch (bcError) {
        console.error('[Audit Controller Error] Blockchain anchoring failed:', bcError.message)
    }
    
    res.status(201).json({ 
      status: 'success', 
      cid: cid,
      tx_hash: txHash,
      packet_hash: packet.packet_hash 
    })
  } catch (error) {
    console.error('[Audit Controller Error] Failed to store packet:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /audit/verify/:stepId - Verify local OrbitDB packet against Blockchain anchor
router.get('/verify/:stepId', async (req, res) => {
  try {
    const stepId = parseInt(req.params.stepId)
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    // 1. Get ALL records
    const entries = await db.all()
    
    // 2. Find the primary audit record for this step
    const primaryRecord = entries.find(e => e.value.step_id === stepId && !e.value._id.startsWith('meta-'))

    if (!primaryRecord) {
      return res.status(404).json({ error: 'Primary record not found in OrbitDB' })
    }

    // 3. Get anchor from Blockchain
    const blockchainRecord = await getRecordFromBlockchain(stepId)

    if (blockchainRecord.timestamp === 0n) {
      return res.status(404).json({ error: 'No anchor found on blockchain for this step' })
    }

    // 4. Compare integrity
    // primaryRecord.hash is the CID of the data *exactly* as it was anchored
    const cidMatches = primaryRecord.hash === blockchainRecord.orbitdbCid
    const merkleMatches = primaryRecord.value.provenance.dataset_merkle_root === blockchainRecord.datasetMerkleRoot
    const isValid = cidMatches && merkleMatches

    console.log(`[Audit Controller] Integrity Check Step ${stepId}: ${isValid ? 'PASSED' : 'FAILED'}`)

    res.json({
      step_id: stepId,
      is_valid: isValid,
      details: {
        cid_match: cidMatches,
        merkle_match: merkleMatches,
        local_cid: primaryRecord.hash,
        blockchain_cid: blockchainRecord.orbitdbCid
      }
    })

  } catch (error) {
    console.error('[Audit Controller Error] Verification failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /audit/sessions - Retrieve unique training sessions
router.get('/sessions', async (req, res) => {
  try {
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    const entries = await db.all()
    
    // Filter out meta records and get unique session IDs
    const primaryRecords = entries.filter(e => e.value.session_id !== undefined && !e.value._id.startsWith('meta-'))
    
    const sessionsMap = {}
    primaryRecords.forEach(p => {
        const sid = p.value.session_id
        if (!sessionsMap[sid]) {
            sessionsMap[sid] = {
                session_id: sid,
                start_time: p.value.timestamp,
                end_time: p.value.timestamp,
                steps: 0
            }
        }
        sessionsMap[sid].steps += 1
        if (new Date(p.value.timestamp) < new Date(sessionsMap[sid].start_time)) {
            sessionsMap[sid].start_time = p.value.timestamp
        }
        if (new Date(p.value.timestamp) > new Date(sessionsMap[sid].end_time)) {
            sessionsMap[sid].end_time = p.value.timestamp
        }
    })

    const sessions = Object.values(sessionsMap).sort((a, b) => 
        new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    )
    
    res.json(sessions)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /audit/packets - Retrieve all audit packets (optionally filtered by session)
router.get('/packets', async (req, res) => {
  try {
    const { session_id } = req.query
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    const entries = await db.all()
    
    // We need to merge primary records with their metadata (tx_hash)
    let primaryRecords = entries.filter(e => e.value.step_id !== undefined && !e.value._id.startsWith('meta-'))
    
    if (session_id) {
        primaryRecords = primaryRecords.filter(e => e.value.session_id === session_id)
    }

    const metaRecords = entries.filter(e => e.value._id.startsWith('meta-'))

    const packets = primaryRecords.map(p => {
        const meta = metaRecords.find(m => m.value.packet_hash === p.value.packet_hash)
        return {
            ...p.value,
            cid: p.hash,
            tx_hash: meta ? meta.value.tx_hash : 'N/A'
        }
    })
    
    res.json(packets)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
