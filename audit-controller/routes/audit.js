import express from 'express'
import { getDB, getHelia } from '../services/orbitdb.js'
import { startSession, syncProgress, completeSession, getSession } from '../services/blockchain.js'
import { unixfs } from '@helia/unixfs'
import { CID } from 'multiformats/cid'
import { auditAllPackets } from '../tools/validity.js'
import { getAnchorsFromChain, getBlockHeight, getBlockNumberByTxHash } from '../services/blockchain.js'
import { calculatePacketHash, verifyHashMatch, calculateDatasetMerkleRoot, calculateHashFromStream } from '../tools/hashlib.js'
import { downloadDirectory } from '../tools/fs.js'
import fs from 'fs';
import path from 'path';
import os from 'os';

const router = express.Router()

// POST /audit/blob - Receive and store large binary data in IPFS
router.post('/blob', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
  try {
    const helia = getHelia()
    if (!helia) return res.status(503).json({ error: 'Helia not initialized' })

    const fs = unixfs(helia)
    const cid = await fs.addBytes(req.body)
    
    console.log(`[Audit Controller] Blob stored | CID: ${cid.toString()}`)
    res.status(201).json({ status: 'success', cid: cid.toString() })
  } catch (error) {
    console.error('[Audit Controller Error] Failed to store blob:', error)
    res.status(500).json({ error: error.message })
  }
})

// POST /audit/dataset/version - Resolve semantic version of a dataset
router.post('/dataset/version', async (req, res) => {
  try {
    const { dataset_name, merkle_root } = req.body
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    const entries = await db.all()
    const datasetEntries = entries
      .filter(e => e.value.type === 'DATASET_SNAPSHOT' && e.value.dataset_name === dataset_name)
      .sort((a, b) => b.value.timestamp - a.value.timestamp)

    const latest = datasetEntries[0]

    if (latest) {
      if (latest.value.merkle_root === merkle_root) {
        return res.json({ version: latest.value.version })
      } else {
        // Increment version
        const parts = latest.value.version.split('.')
        const minor = parseInt(parts[1]) + 1
        const newVersion = `${parts[0]}.${minor}`
        
        const newEntry = {
          _id: `ds-${dataset_name}-${newVersion}`,
          type: 'DATASET_SNAPSHOT',
          dataset_name,
          merkle_root,
          version: newVersion,
          parent_root: latest.value.merkle_root,
          timestamp: Date.now()
        }
        await db.put(newEntry)
        return res.json({ version: newVersion })
      }
    } else {
      // Initialize as v1.0
      const initialVersion = 'v1.0'
      const newEntry = {
        _id: `ds-${dataset_name}-${initialVersion}`,
        type: 'DATASET_SNAPSHOT',
        dataset_name,
        merkle_root,
        version: initialVersion,
        timestamp: Date.now()
      }
      await db.put(newEntry)
      return res.json({ version: initialVersion })
    }
  } catch (error) {
    console.error('[Audit Controller Error] Failed to resolve version:', error)
    res.status(500).json({ error: error.message })
  }
})

// POST /audit/dataset/directory
router.post('/dataset/directory', async (req, res) => {
  try {
    const { files } = req.body
    const helia = getHelia()
    if (!helia) return res.status(503).json({ error: 'Helia not initialized' })
    const fs = unixfs(helia)

    let rootCid = await fs.addDirectory()
    console.log(`[Audit Controller] Building directory structure for ${files.length} files...`)

    for (const file of files) {
      try {
        const fileCid = CID.parse(file.cid)
        rootCid = await fs.cp(fileCid, rootCid, file.path)
      } catch (err) {
        console.warn(`[Audit Controller] Failed to link file ${file.path}:`, err.message)
      }
    }

    const finalCid = rootCid.toString()
    console.log(`[Audit Controller] Dataset directory finalized | Root CID: ${finalCid}`)

    res.status(201).json({ status: 'success', root_cid: finalCid, file_count: files.length })
  } catch (error) {
    console.error('[Audit Controller Error] Failed to create directory:', error)
    res.status(500).json({ error: error.message })
  }
})

// POST /audit/packet - Receive and store audit packet
router.post('/packet', async (req, res) => {
  try {
    const packet = req.body.packet
    const packetHash = req.body.packet_hash
    const db = getDB()

    if (!db) {
      return res.status(503).json({ error: 'Database not initialized' })
    }

    // 1. Store the IMMUTABLE part in OrbitDB first to get the CID
    // We DO NOT include tx_hash here because it would change the CID later
    let entryId = ""
    let blockHeight = null
    if (packet.type === 'session') {
      entryId = `session-${packet.session_id}-${packet.action}`
      if (packet.action === 'start') {
        blockHeight = await getBlockHeight()
      }
    } else if (packet.type === 'epoch' || packet.type === 'step') {
      entryId = `session-${packet.session_id}-${packet.type}-${packet.payload.id}`
    } else {
      return res.status(400).json({ error: 'Invalid packet type' })
    }
    const auditEntry = {
      _id: entryId,
      packet: packet,
      packet_hash: packetHash,
      timestamp: new Date().toISOString()
    }
    if (blockHeight) {
      auditEntry.block_height = blockHeight
    }

    const cid = await db.put(auditEntry)
    console.log(`[Audit Controller] Audit stored | ${entryId}`)

    // 2. Anchor the resulting CID to the Ganache smart contract by updating session progress
    let txHash = 'N/A'
    try {
      if (packet.type === 'session') {
        if (packet.action === 'start') {
          // For session start, we anchor the dataset merkle root
          blockHeight = await getBlockHeight()
          txHash = await startSession(packet.session_id, packet.payload.dataset_merkle_root)
        } else if (packet.action === 'end') {
          // For session complete, we anchor the final packet hash
          txHash = await completeSession(packet.session_id, packetHash)
        }
      } else {
        // For steps and epochs, we anchor by syncing the latest packet hash to the session
        const stepId = packet.type === 'step' ? packet.payload.id : packet.payload.step_id
        txHash = await syncProgress(packet.session_id, packetHash, stepId)
      }
      // 3. Store the TX hash as a SEPARATE metadata entry or property
      // To keep the CID valid for verification, we store a secondary mapping
      const metaEntry = {
        _id: `meta-${packetHash}`,
        packet_hash: packetHash,
        tx_hash: txHash,
        cid: cid
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
      packet_hash: packetHash
    })
  } catch (error) {
    console.error('[Audit Controller Error] Failed to store packet:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /audit/verify/session/:id - Verify entire session integrity by comparing local records with blockchain anchor
router.get('/verify/session/:id', async (req, res) => {
  try {
    const sessionId = req.params.id
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    const sessionOnChain = await getSession(sessionId)
    if (!sessionOnChain || !sessionOnChain.isActive) {
      return res.status(404).json({ error: 'No active session anchor found on blockchain for this session' })
    }

    // get all packets for this session
    const entries = await db.all()
    const sessionPackets = entries.filter(e => e.value.packet.session_id === sessionId && !e.value._id.startsWith('meta-'))

    // sort packets by timestamp in reverse order
    sessionPackets.sort((a, b) => new Date(b.value.timestamp).getTime() - new Date(a.value.timestamp).getTime())

    const sessionEndAnchorHash = sessionOnChain.latestPacketHash
    const calculatedHash = calculatePacketHash(sessionPackets[0].value.packet)
    let modelValidityState = 'untrusted'

    if (verifyHashMatch(calculatedHash, sessionEndAnchorHash)) {
      modelValidityState = 'verified'
    } else {
      modelValidityState = 'invalid'
    }

    const blockHeight = sessionPackets[sessionPackets.length].value.block_height
    const chainAnchors = await getAnchorsFromChain(sessionId, blockHeight)
    const validityStates = await auditAllPackets(sessionPackets.slice(1, sessionPackets.length), chainAnchors)

    res.status(200).json({
      modelValidation: modelValidityState,
      stepsValidation: validityStates
    })
  } catch (error) {
    console.error('[Audit Controller Error] Verification failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /audit/verify/session/:sessionId/dataset - Verify dataset integrity by comparing local merkle root with blockchain anchor
router.get('/verify/session/:sessionId/dataset', async (req, res) => {
  try {
    const { sessionId } = req.params
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    const entries = await db.all()
    const sessionStartPacket = entries.find(e => 
      e.value.packet.session_id === sessionId && 
      e.value.packet.type === 'session' && 
      e.value.packet.action === 'start'
    )

    if (!sessionStartPacket) {
      return res.status(404).json({ error: 'Session start packet not found in OrbitDB' })
    }

    const sessionOnChain = await getSession(sessionId)
    if (!sessionOnChain || !sessionOnChain.isActive) {
      return res.status(404).json({ error: 'No active session anchor found on blockchain for this session' })
    }

    const anchorMerkleRoot = sessionOnChain.datasetMerkleRoot
  
    // download dataset snapshot from IPFS using the CID in the session start packet
    const datasetCid = sessionStartPacket.value.packet.payload.dataset_cid
    const helia = getHelia()
    if (!helia) return res.status(503).json({ error: 'Helia not initialized' })
    const heliaFs = unixfs(helia)

    const tempDir = path.join(os.tmpdir(), `audit-${Date.now()}`);
    fs.mkdirSync(tempDir);
    await downloadDirectory(heliaFs, datasetCid, tempDir)

    const calculatedMerkleRoot = calculateDatasetMerkleRoot(tempDir)
    const isValid = verifyHashMatch(calculatedMerkleRoot, anchorMerkleRoot)

    console.log(`[Audit Controller] Dataset Integrity Check: ${isValid ? 'PASSED' : 'FAILED'}`)

    res.json({
      is_valid: isValid,
      details: {
        anchor_merkle_root: anchorMerkleRoot,
        calculated_merkle_root: calculatedMerkleRoot,
        dataset_cid: datasetCid
      }
    })

  } catch (error) {
    console.error('[Audit Controller Error] Verification failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /audit/verify/session/:sessionId/model - Verify model weights integrity by comparing local hash with blockchain anchor
router.get('/verify/session/:sessionId/model', async (req, res) => {
  try {
    const { sessionId } = req.params
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    // find session end packet to get the final model hash
    const entries = await db.all()
    const sessionEndPacket = entries.find(e => 
      e.value.packet.session_id === sessionId && 
      e.value.packet.type === 'session' && 
      e.value.packet.action === 'end'
    )

    if (!sessionEndPacket) {
      return res.status(404).json({ error: 'Session end packet not found in OrbitDB' })
    }

    const targetModelHash = sessionEndPacket.value.packet.payload.model_hash

    const modelCid = sessionEndPacket.value.packet.payload.model_cid
    const helia = getHelia()
    if (!helia) return res.status(503).json({ error: 'Helia not initialized' })
    const heliaFs = unixfs(helia)
    const calculatedModelHash = await calculateHashFromStream(heliaFs, modelCid)
    
    const isValid = verifyHashMatch(calculatedModelHash, targetModelHash)
    console.log(`[Audit Controller] Model Integrity Check: ${isValid ? 'PASSED' : 'FAILED'}`)

    res.json({
      is_valid: isValid,
      details: {
        target_model_hash: targetModelHash,
        calculated_model_hash: calculatedModelHash,
        model_cid: modelCid
      }
    })
  } catch (error) {
    console.error('[Audit Controller Error] Verification failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /audit/verify/session/:sessionId/epoch/:epochId/checkpoint - Verify specific epoch integrity by comparing local record with blockchain anchor
router.get('/verify/session/:sessionId/epoch/:epochId/checkpoint', async (req, res) => {
  try {
    const { sessionId, epochId } = req.params
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    // find the specific epoch packet
    const entries = await db.all()
    const epochPacket = entries.find(e => 
      e.value.packet.session_id === sessionId && 
      e.value.packet.type === 'epoch' && 
      e.value.packet.payload.id === parseInt(epochId)
    )

    if (!epochPacket) {
      return res.status(404).json({ error: 'Epoch packet not found in OrbitDB' })
    }

    const targetCheckpointHash = epochPacket.value.packet.payload.checkpoint_hash

    const checkpointCid = epochPacket.value.packet.payload.checkpoint_cid
    const helia = getHelia()
    if (!helia) return res.status(503).json({ error: 'Helia not initialized' })
    const heliaFs = unixfs(helia)
    const calculatedCheckpointHash = await calculateHashFromStream(heliaFs, checkpointCid)
    
    const isValid = verifyHashMatch(calculatedCheckpointHash, targetCheckpointHash)
    console.log(`[Audit Controller] Epoch Checkpoint Integrity Check: ${isValid ? 'PASSED' : 'FAILED'}`)

    res.json({
      is_valid: isValid,
      details: {
        target_checkpoint_hash: targetCheckpointHash,
        calculated_checkpoint_hash: calculatedCheckpointHash,
        checkpoint_cid: checkpointCid
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
    const metaRecords = entries.filter(e => e.value._id.startsWith('meta-'))

    // Filter out meta records and get unique session IDs
    const primaryRecords = entries.filter(e => e.value.packet.session_id !== undefined && !e.value._id.startsWith('meta-'))
    
    const sessionsMap = {}
    await Promise.all(primaryRecords.map(async (p) => {
      const sid = p.value.packet.session_id
      if (!sessionsMap[sid]) {
        sessionsMap[sid] = {
          session_id: sid,
          start_time: p.value.timestamp,
          end_time: p.value.timestamp,
          steps: 0
        }
      }
      const meta = metaRecords.find(m => m.value.packet_hash === p.value.packet_hash)

      if (p.value.packet.type === 'session' && p.value.packet.action === 'start') {
        sessionsMap[sid].start_time = p.value.timestamp
        sessionsMap[sid].dataset_name = p.value.packet.payload.dataset_name
        sessionsMap[sid].dataset_version = p.value.packet.payload.dataset_version
        sessionsMap[sid].dataset_merkle_root = p.value.packet.payload.dataset_merkle_root
        sessionsMap[sid].dataset_cid = p.value.packet.payload.dataset_cid
        sessionsMap[sid].hyperparams = p.value.packet.payload.hyperparams
        sessionsMap[sid].start_tx_hash = meta ? meta.value.tx_hash : 'N/A'
        sessionsMap[sid].start_block_number = meta && meta.value.tx_hash !== 'N/A' ? await getBlockNumberByTxHash(meta.value.tx_hash) : -1
      } else if (p.value.packet.type === 'epoch') {
        if (p.value.packet.payload.step_id > sessionsMap[sid].steps) {
          sessionsMap[sid].steps = p.value.packet.payload.step_id
        }
      } else if (p.value.packet.type === 'session' && p.value.packet.action === 'end') {
        sessionsMap[sid].end_time = p.value.timestamp
        sessionsMap[sid].model_cid = p.value.packet.payload.model_cid
        sessionsMap[sid].model_hash = p.value.packet.payload.model_hash
        sessionsMap[sid].end_tx_hash = meta ? meta.value.tx_hash : 'N/A'
        sessionsMap[sid].end_block_number = meta && meta.value.tx_hash !== 'N/A' ? await getBlockNumberByTxHash(meta.value.tx_hash) : -1
      }
    }))

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
    const { sessionId } = req.query
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    const entries = await db.all()
    
    // We need to merge primary records with their metadata (tx_hash)
    let primaryRecords = entries.filter(e => 
      e.value.packet.type !== "session" && 
      !e.value._id.startsWith('meta-')
    )
    
    if (sessionId) {
      primaryRecords = primaryRecords.filter(e => e.value.packet.session_id === sessionId)
    }

    const metaRecords = entries.filter(e => e.value._id.startsWith('meta-'))

    const packets = await Promise.all(primaryRecords.map(async (p) => {
      const meta = metaRecords.find(m => m.value.packet_hash === p.value.packet_hash)
      return {
        ...p.value,
        cid: meta ? meta.value.cid : 'N/A',
        tx_hash: meta ? meta.value.tx_hash : 'N/A',
        block_number: meta && meta.value.tx_hash !== 'N/A' ? await getBlockNumberByTxHash(meta.value.tx_hash) : -1
      }
    }))
    
    const steps = packets.filter(p => p.packet.type === 'step').map(p => {
      return {
        step_id: p.packet.payload.id,
        session_id: p.packet.session_id,
        epoch_id: 0, // to be filled later by frontend based on step-epoch mapping
        metrics: p.packet.payload.metrics,
        block_number: p.block_number,
        tx_hash: p.tx_hash,
        timestamp: p.timestamp,
        cid: p.cid
      }
    })

    const epochs = packets.filter(p => p.packet.type === 'epoch').map(p => {
      return {
        epoch: p.packet.payload.id,
        session_id: p.packet.session_id,
        step_id: p.packet.payload.step_id,
        tx_hash: p.tx_hash,
        block_number: p.block_number,
        checkpoint_cid: p.packet.payload.checkpoint_cid,
        checkpoint_hash: p.packet.payload.checkpoint_hash,
        timestamp: p.timestamp
      }
    })

    res.json({
      steps: steps,
      epochs: epochs
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /audit/sessions/:sessionId - Return on-chain session info (dataset merkle root, latest packet hash, flags)
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const sessionId = req.params.sessionId
    const sessionOnChain = await getSession(sessionId)
    if (!sessionOnChain)
      return res.status(404).json({ error: 'Session not found on chain' })

    res.json({
      session_id: sessionId,
      datasetMerkleRoot: sessionOnChain.datasetMerkleRoot,
      latestPacketHash: sessionOnChain.latestPacketHash,
      isActive: sessionOnChain.isActive,
      isCompleted: sessionOnChain.isCompleted,
    })
  } catch (error) {
    console.error('[Audit Controller Error] Failed to fetch session on-chain info:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
