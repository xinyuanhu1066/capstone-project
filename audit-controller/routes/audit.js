import express from 'express'
import { getDB, getHelia } from '../services/orbitdb.js'
import { startSession, syncProgressAsync, completeSession, getSession } from '../services/blockchain.js'
import { unixfs } from '@helia/unixfs'
import { CID } from 'multiformats/cid'
import { auditAllPackets } from '../tools/validity.js'
import { getAnchorsFromChain, getBlockHeight, getBlockNumberByTxHash } from '../services/blockchain.js'
import { calculatePacketHash, verifyHashMatch, calculateDatasetMerkleRoot, calculateHashFromStream } from '../tools/hashlib.js'
import { downloadDirectory } from '../tools/fs.js'
import fs from 'fs';
import path from 'path';
import os from 'os';
import fsPromises from 'fs/promises';
import { sha256 } from 'multiformats/hashes/sha2'
import { UnixFS } from 'ipfs-unixfs'
import * as dagPB from '@ipld/dag-pb'
import { deriveEntryId } from '../tools/strings.js'
import { getLogger } from '../tools/instrumentation.js'
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api'
import { consumeFault } from './debug.js'

const router = express.Router()

const tracer = trace.getTracer('audit')
const meter = metrics.getMeter('audit')

const verifyDurationHistogram = meter.createHistogram('audit_verify_duration_ms', {
  description: 'Verification endpoint response time'
})

const packetIngestCounter = meter.createCounter('audit_packet_ingested_total', {
  description: 'Total audit packets received by controller'
})

const packetE2eHistogram = meter.createHistogram('audit_packet_e2e_duration_ms', {
  description: 'End-to-end latency from packet receipt to OrbitDB write complete'
})

const tamperDetectionCounter = meter.createCounter('audit_tamper_detection_total', {
  description: 'Tamper detection outcomes across all verify endpoints'
})

const orphanTxCounter = meter.createCounter('audit_orphan_tx_total', {
  description: 'On-chain anchored packets that failed OrbitDB write (compensation required)'
})

const recordVerifyDuration = (startTime, verifyType, isValid) => {
  verifyDurationHistogram.record(Date.now() - startTime, {
    verify_type: verifyType,
    result: isValid ? 'passed' : 'failed'
  })
}

// POST /audit/blob - Receive and store large binary data in IPFS
router.post('/blob', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
  return tracer.startActiveSpan('audit.blob.store', async (span) => {
    const log = getLogger()
    span.setAttributes({ 'blob.size_bytes': req.body.length })
    try {
      const helia = getHelia()
      if (!helia) return res.status(503).json({ error: 'Helia not initialized' })
      const heliaFs = unixfs(helia)
      const cid = await heliaFs.addBytes(req.body)
      span.setAttributes({ 'blob.cid': cid.toString() })
      log.info({ event: 'blob.stored', cid: cid.toString(), size_bytes: req.body.length })
      res.status(201).json({ status: 'success', cid: cid.toString() })
    } catch (error) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      log.error({ event: 'blob.store_failed', size_bytes: req.body.length })
      res.status(500).json({ error: error.message })
    } finally {
      span.end()
    }
  })
})

// POST /audit/dataset/version - Resolve semantic version of a dataset
router.post('/dataset/version', async (req, res) => {
  const log = getLogger()
  try {
    const { dataset_name, merkle_root } = req.body
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    const entries = await db.all()
    const datasetEntries = entries
      .filter(e => e.value.type === 'DATASET_SNAPSHOT' && e.value.dataset_name === dataset_name)
      .sort((a, b) => b.value.timestamp - a.value.timestamp)

    const latest = datasetEntries[0]
    let resolvedVersion

    if (latest) {
      if (latest.value.merkle_root === merkle_root) {
        resolvedVersion = latest.value.version
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
        resolvedVersion = newVersion
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
      resolvedVersion = initialVersion
    }
    log.info({ event: 'dataset.version.resolved', dataset_name, version: resolvedVersion })
    return res.json({ version: resolvedVersion })
  } catch (error) {
    log.error({ event: 'dataset.version.resolve_failed', dataset_name: req.body.dataset_name })
    res.status(500).json({ error: error.message })
  }
})

// POST /audit/dataset/directory
router.post('/dataset/directory', async (req, res) => {
  return tracer.startActiveSpan('audit.dataset.build_directory', async (span) => {
    const log = getLogger()
    const { files } = req.body
    span.setAttributes({ 'dataset.file_count': files.length })
    try {
      const helia = getHelia()
      if (!helia) return res.status(503).json({ error: 'Helia not initialized' })
      log.info({ event: 'dataset.directory.building', file_count: files.length })

      const buildTree = (files) => {
        const tree = {}
        for (const file of files) {
          const parts = file.path.split('/')
          let node = tree
          for (let i = 0; i < parts.length - 1; i++) {
            if (!node[parts[i]]) node[parts[i]] = {}
            node = node[parts[i]]
          }
          node[parts[parts.length - 1]] = CID.parse(file.cid)
        }
        return tree
      }

      const createDirNode = async (helia, node) => {
        const links = []
        for (const [name, value] of Object.entries(node)) {
          if (value instanceof CID) {
            links.push(dagPB.createLink(name, 0, value))
          } else {
            const childCid = await createDirNode(helia, value)
            links.push(dagPB.createLink(name, 0, childCid))
          }
        }

        const unixfsDir = new UnixFS({ type: 'directory' })
        const node2 = dagPB.createNode(unixfsDir.marshal(), links)
        const bytes = dagPB.encode(node2)
        const hash = await sha256.digest(bytes)
        const cid = CID.create(1, dagPB.code, hash)
        await helia.blockstore.put(cid, bytes)
        return cid
      }

      const tree = buildTree(files)
      const rootCid = await createDirNode(helia, tree)

      span.setAttributes({ 'dataset.root_cid': rootCid.toString() })
      log.info({ event: 'dataset.directory.built', root_cid: rootCid.toString(), file_count: files.length })
      res.status(201).json({ status: 'success', root_cid: rootCid.toString(), file_count: files.length })
    } catch (error) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      log.error({ event: 'dataset.directory.build_failed', file_count: files?.length })
      res.status(500).json({ error: error.message })
    } finally {
      span.end()
    }
  })
})

// POST /audit/packet - Receive and store audit packet
router.post('/packet', async (req, res) => {
  const e2eStart = Date.now()
  return tracer.startActiveSpan('audit.packet.store', async (span) => {
    const log = getLogger()
    const { packet, packet_hash } = req.body
    span.setAttributes({
      'packet.type': packet.type,
      'packet.action': packet.action ?? '',
      'session.id': packet.session_id,
    })
    packetIngestCounter.add(1, { packet_type: packet.type, session_id: packet.session_id })

    // 1. Anchor the packet on blockchain
    let txHash = 'N/A'
    try {
      if (packet.type === 'session') {
        if (packet.action === 'start') {
          // For session start, we anchor the dataset merkle root
          txHash = await startSession(packet.session_id, packet.payload.dataset_merkle_root)
        } else if (packet.action === 'end') {
          // For session complete, we anchor the final packet hash
          txHash = await completeSession(packet.session_id, packet_hash)
        }
      } else {
        // For steps and epochs, we anchor by syncing the latest packet hash to the session
        const stepId = packet.type === 'step' ? packet.payload.id : packet.payload.step_id
        txHash = await syncProgressAsync(packet.session_id, packet_hash, stepId)
      }
      span.setAttributes({ 'tx.hash': txHash })
      log.info({ event: 'packet.anchored', session_id: packet.session_id, packet_type: packet.type, tx_hash: txHash })
    } catch (bcError) {
      span.recordException(bcError)
      span.setStatus({ code: SpanStatusCode.ERROR })
      log.error({ event: 'packet.anchor_failed', session_id: packet.session_id, packet_type: packet.type })
      span.end()
      // No need to write off-chain data
      return res.status(500).json({
        error: 'Blockchain anchoring failed',
        detail: bcError.message
      })
    }

    //2. Store packet into OrbitDB only if on-chain anchoring succeeded
    let blockHeight = null
    try {
      const entryId = deriveEntryId(packet)
      if (packet.type === 'session' && packet.action === 'start') {
          blockHeight = await getBlockHeight()
      }
      const auditEntry = {
        _id: entryId,
        packet, packet_hash,
        tx_hash: txHash,
        timestamp: new Date().toISOString(),
        block_height: blockHeight
      }

      const db = getDB()

      const fault = consumeFault()
      if (fault?.target === 'orbitdb_write') {
        if (fault.fault_type === 'process_crash') {
          throw new Error('[INJECTED] Simulated process crash before OrbitDB write')
        } else if (fault.fault_type === 'network_partition') {
          await new Promise(r => setTimeout(r, 10000))
          throw new Error('[INJECTED] Simulated network partition: OrbitDB write timeout')
        }
      }

      await db.put(auditEntry)
      log.info({ event: 'packet.stored', entry_id: entryId, session_id: packet.session_id })
      span.end()

      packetE2eHistogram.record(Date.now() - e2eStart, { session_id: packet.session_id })

      return res.status(201).json({ status: 'success', tx_hash: txHash })
    } catch (dbError) {
      fs.appendFileSync('./orphan-txs.log', 
        JSON.stringify({
          tx_hash: txHash,
          packet_hash, packet, 
          block_height: blockHeight,
          timestamp: Date.now()
        }) + '\n'
      )
      orphanTxCounter.add(1, { packet_type: packet.type, session_id: packet.session_id })
      span.recordException(dbError)
      log.error({ event: 'packet.orbitdb_write_failed', session_id: packet.session_id, tx_hash: txHash })
      span.end()
      // still returns success because on-chain anchoring is done
      return res.status(201).json({ status: 'partial', tx_hash: txHash })
    }
  })
})

// GET /audit/verify/session/:id - Verify entire session integrity by comparing local records with blockchain anchor
router.get('/verify/session/:id', async (req, res) => {
  const start = Date.now()
  return tracer.startActiveSpan('audit.verify.session', async (span) => {
    const log = getLogger()
    const sessionId = req.params.id
    span.setAttributes({ 'session.id': sessionId })

    try {
      const db = getDB()
      if (!db) return res.status(503).json({ error: 'Database not initialized' })

      const sessionOnChain = await getSession(sessionId)
      if (!sessionOnChain || !sessionOnChain.isActive) {
        return res.status(404).json({ error: 'No active session anchor found on blockchain for this session' })
      }

      // get all packets for this session
      const entries = await db.all()
      const sessionPackets = entries.filter(e => !e.value._id.startsWith('meta-') && !e.value._id.startsWith('ds-') && e.value.packet.session_id === sessionId)

      // sort packets by timestamp in reverse order
      sessionPackets.sort((a, b) => new Date(b.value.timestamp).getTime() - new Date(a.value.timestamp).getTime())

      const sessionEndAnchorHash = sessionOnChain.latestPacketHash
      const calculatedHash = calculatePacketHash(sessionPackets[0].value.packet)
      let sessionEndValidity = 'untrusted'

      if (verifyHashMatch(calculatedHash, sessionEndAnchorHash)) {
        sessionEndValidity = 'verified'
      } else {
        sessionEndValidity = 'invalid'
      }

      const blockHeight = sessionPackets[sessionPackets.length - 1].value.block_height
      const { anchorMap, sessionStartMerkleRoot } = await getAnchorsFromChain(sessionId, blockHeight)
      
      const sessionStartPacket = sessionPackets[sessionPackets.length - 1]
      
      const calculatedStartHash = calculatePacketHash(sessionStartPacket.value.packet)
      const storedStartHash = sessionStartPacket.value.packet_hash
      const packetIntact = verifyHashMatch(calculatedStartHash, storedStartHash)
      const merkleRootMatch = verifyHashMatch(sessionStartPacket.value.packet.payload.dataset_merkle_root, sessionStartMerkleRoot)
      const sessionStartValidity = packetIntact && merkleRootMatch ? 'verified' : 'invalid'

      const validityStates = await auditAllPackets(sessionPackets.slice(1, sessionPackets.length - 1), anchorMap)

      const allStepsVerified = Object.values(validityStates).every(v => v === 'verified')
      const isValid = sessionEndValidity === 'verified' && sessionStartValidity === 'verified' && allStepsVerified
      span.setAttributes({ 'verify.result': isValid })
      log.info({ event: 'session.verified', session_id: sessionId, result: isValid })

      recordVerifyDuration(start, 'session', isValid)
      tamperDetectionCounter.add(1, {
        verify_type: 'session',
        result: isValid ? 'passed' : 'tampered'
      })

      res.status(200).json({
        sessionStartValidity: sessionStartValidity,
        sessionEndValidity: sessionEndValidity,
        stepsValidities: validityStates,
        isValid
      })
    } catch (error) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      log.error({ event: 'session.verify_failed', session_id: sessionId })
      res.status(500).json({ error: error.message })
    } finally {
      span.end()
    }
  })
})

// GET /audit/verify/session/:sessionId/dataset - Verify dataset integrity by comparing local merkle root with blockchain anchor
router.get('/verify/session/:sessionId/dataset', async (req, res) => {
  const start = Date.now()
  const tempDir = path.join(os.tmpdir(), `audit-dataset-${Date.now()}`)

  return tracer.startActiveSpan('audit.verify.dataset', async (span) => {
    const log = getLogger()
    const sessionId = req.params.sessionId
    span.setAttributes({ 'session.id': sessionId })

    try {
      const db = getDB()
      if (!db) return res.status(503).json({ error: 'Database not initialized' })

      const entries = await db.all()
      const sessionStartPacket = entries.find(e => 
        !e.value._id.startsWith('meta-') && !e.value._id.startsWith('ds-') &&
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

      let downloadFailed = false
      let downloadError = null

      await tracer.startActiveSpan('audit.ipfs.download_directory', async (dlSpan) => {
        dlSpan.setAttributes({ 'dataset.cid': datasetCid })
        try {
          await downloadDirectory(helia, datasetCid, tempDir)
        } catch (dlError) {
          downloadFailed = true
          downloadError = dlError.message
        } finally {
          dlSpan.end()
        }
      })

      if (downloadFailed) {
        recordVerifyDuration(start, 'dataset', false)
        tamperDetectionCounter.add(1, { verify_type: 'dataset', result: 'tampered' })
        return res.json({
          is_valid: false,
          details: {
            reason: 'Dataset download failed — CID may be invalid or content unavailable',
            dataset_cid: datasetCid,
            error: downloadError
          }
        })
      }

      const calculatedMerkleRoot = calculateDatasetMerkleRoot(tempDir)
      const isValid = verifyHashMatch(calculatedMerkleRoot, anchorMerkleRoot)

      span.setAttributes({ 'verify.result': isValid })
      log.info({ event: 'dataset.verified', session_id: sessionId, result: isValid })
      recordVerifyDuration(start, 'dataset', isValid)
      tamperDetectionCounter.add(1, {
        verify_type: 'dataset',
        result: isValid ? 'passed' : 'tampered'
      })

      res.json({
        is_valid: isValid,
        details: {
          anchor_merkle_root: anchorMerkleRoot,
          calculated_merkle_root: calculatedMerkleRoot,
          dataset_cid: datasetCid
        }
      })
    } catch (error) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      log.error({ event: 'dataset.verify_failed', session_id: sessionId })
      res.status(500).json({ error: error.message })
    } finally {
      span.end()
      await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})

// GET /audit/verify/session/:sessionId/model - Verify model weights integrity by comparing local hash with blockchain anchor
router.get('/verify/session/:sessionId/model', async (req, res) => {
  const start = Date.now()
  return tracer.startActiveSpan('audit.verify.model', async (span) => {
    const log = getLogger()
    const sessionId = req.params.sessionId
    span.setAttributes({ 'session.id': sessionId })

    try {
      const db = getDB()
      if (!db) return res.status(503).json({ error: 'Database not initialized' })

      // find session end packet to get the final model hash
      const entries = await db.all()
      const sessionEndPacket = entries.find(e => 
        !e.value._id.startsWith('meta-') && !e.value._id.startsWith('ds-') &&
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

      const calculatedModelHash = await calculateHashFromStream(helia, modelCid)
      
      const isValid = verifyHashMatch(calculatedModelHash, targetModelHash)

      span.setAttributes({ 'verify.result': isValid })
      log.info({ event: 'model.verified', session_id: sessionId, result: isValid })
      recordVerifyDuration(start, 'model', isValid)
      tamperDetectionCounter.add(1, {
        verify_type: 'model',
        result: isValid ? 'passed' : 'tampered'
      })

      res.json({
        is_valid: isValid,
        details: {
          target_model_hash: targetModelHash,
          calculated_model_hash: calculatedModelHash,
          model_cid: modelCid
        }
      })
    } catch (error) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      log.error({ event: 'model.verify_failed', session_id: sessionId })
      res.status(500).json({ error: error.message })
    } finally {
      span.end()
    }
  })
})

// GET /audit/verify/session/:sessionId/epoch/:epochId/checkpoint - Verify specific epoch integrity by comparing local record with blockchain anchor
router.get('/verify/session/:sessionId/epoch/:epochId/checkpoint', async (req, res) => {
  const start = Date.now()
  return tracer.startActiveSpan('audit.verify.checkpoint', async (span) => {
    const log = getLogger()
    const { sessionId, epochId } = req.params
    span.setAttributes({ 'session.id': sessionId, 'epoch.id': epochId })

    try {
      const db = getDB()
      if (!db) return res.status(503).json({ error: 'Database not initialized' })

      // find the specific epoch packet
      const entries = await db.all()
      const epochPacket = entries.find(e => 
        !e.value._id.startsWith('meta-') && !e.value._id.startsWith('ds-') &&
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
      const calculatedCheckpointHash = await calculateHashFromStream(helia, checkpointCid)
      
      const isValid = verifyHashMatch(calculatedCheckpointHash, targetCheckpointHash)

      span.setAttributes({ 'verify.result': isValid })
      log.info({ event: 'checkpoint.verified', session_id: sessionId, epoch_id: epochId, result: isValid })
      recordVerifyDuration(start, 'checkpoint', isValid)
      tamperDetectionCounter.add(1, {
        verify_type: 'checkpoint',
        result: isValid ? 'passed' : 'tampered'
      })

      res.json({
        is_valid: isValid,
        details: {
          target_checkpoint_hash: targetCheckpointHash,
          calculated_checkpoint_hash: calculatedCheckpointHash,
          checkpoint_cid: checkpointCid
        }
      })
    } catch (error) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      log.error({ event: 'checkpoint.verify_failed', session_id: sessionId, epoch_id: epochId })
      res.status(500).json({ error: error.message })
    } finally {
      span.end()
    }
  })
})

// GET /audit/sessions - Retrieve unique training sessions
router.get('/sessions', async (req, res) => {
  try {
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    const entries = await db.all()

    // Filter out meta and ds records and get unique session IDs
    const primaryRecords = entries.filter(e => !e.value._id.startsWith('meta-') && !e.value._id.startsWith('ds-') && e.value.packet.session_id !== undefined)
    
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

      if (p.value.packet.type === 'session' && p.value.packet.action === 'start') {
        sessionsMap[sid].start_time = p.value.timestamp
        sessionsMap[sid].dataset_name = p.value.packet.payload.dataset_name
        sessionsMap[sid].dataset_version = p.value.packet.payload.dataset_version
        sessionsMap[sid].dataset_merkle_root = p.value.packet.payload.dataset_merkle_root
        sessionsMap[sid].dataset_cid = p.value.packet.payload.dataset_cid
        sessionsMap[sid].hyperparams = p.value.packet.payload.hyperparams
        sessionsMap[sid].start_tx_hash = p.value.tx_hash
        sessionsMap[sid].start_block_number = p.value.tx_hash !== 'N/A' ? await getBlockNumberByTxHash(p.value.tx_hash) : -1
      } else if (p.value.packet.type === 'epoch') {
        if (p.value.packet.payload.step_id > sessionsMap[sid].steps) {
          sessionsMap[sid].steps = p.value.packet.payload.step_id
        }
      } else if (p.value.packet.type === 'session' && p.value.packet.action === 'end') {
        sessionsMap[sid].end_time = p.value.timestamp
        sessionsMap[sid].model_cid = p.value.packet.payload.model_cid
        sessionsMap[sid].model_hash = p.value.packet.payload.model_hash
        sessionsMap[sid].end_tx_hash = p.value.tx_hash
        sessionsMap[sid].end_block_number = p.value.tx_hash !== 'N/A' ? await getBlockNumberByTxHash(p.value.tx_hash) : -1
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

// GET /audit/session/:sessionId/packets - Retrieve all audit packets filtered by session
router.get('/session/:sessionId/packets', async (req, res) => {
  try {
    const sessionId = req.params.sessionId
    const db = getDB()
    if (!db) return res.status(503).json({ error: 'Database not initialized' })

    const entries = await db.all()

    let primaryRecords = entries.filter(e => 
      !e.value._id.startsWith('meta-') && 
      !e.value._id.startsWith('ds-') && 
      e.value.packet.type !== "session"
    )

    primaryRecords = primaryRecords.filter(e => e.value.packet.session_id === sessionId)

    const packets = await Promise.all(primaryRecords.map(async (p) => {
      const entryId = deriveEntryId(p.value.packet)
      const entry = await db.get(entryId)
      const cid = entry?.hash
      return {
        ...p.value,
        cid: cid ? cid : 'N/A',
        block_number: p.value.tx_hash !== 'N/A' ? await getBlockNumberByTxHash(p.value.tx_hash) : -1
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
    if (!sessionOnChain) {
      log.error({ event: 'session.not_found_on_chain', session_id: sessionId })
      return res.status(404).json({ error: 'Session not found on chain' })
    }

    res.json({
      session_id: sessionId,
      datasetMerkleRoot: sessionOnChain.datasetMerkleRoot,
      latestPacketHash: sessionOnChain.latestPacketHash,
      isActive: sessionOnChain.isActive,
      isCompleted: sessionOnChain.isCompleted,
    })
  } catch (error) {
    log.error({ event: 'session.fetch_failed', session_id: req.params.sessionId })
    res.status(500).json({ error: error.message })
  }
})

// GET /audit/session/:sessionId/coverage
router.get('/session/:sessionId/coverage', async (req, res) => {
  return tracer.startActiveSpan('audit.session.coverage', async (span) => {
    const log = getLogger()
    const { sessionId } = req.params
    span.setAttributes({ 'session.id': sessionId })

    try {
      const db = getDB()
      if (!db) return res.status(503).json({ error: 'Database not initialized' })

      const entries = await db.all()

      const startPacket = entries.find(e =>
        !e.value._id.startsWith('meta-') && !e.value._id.startsWith('ds-') &&
        e.value.packet.session_id === sessionId &&
        e.value.packet.type === 'session' &&
        e.value.packet.action === 'start'
      )
      if (!startPacket) {
        return res.status(404).json({ error: 'Session start packet not found' })
      }

      const { epochs, batch_size, step_interval } = startPacket.value.packet.payload.hyperparams
      const sessionPackets = entries.filter(e =>
        !e.value._id.startsWith('meta-') && !e.value._id.startsWith('ds-') &&
        e.value.packet.session_id === sessionId
      )

      const capturedStepPackets = sessionPackets.filter(e =>
        e.value.packet.type === 'step'
      )
      const capturedEpochPackets = sessionPackets.filter(e =>
        e.value.packet.type === 'epoch'
      )

      const maxStepId = capturedStepPackets.reduce((max, e) =>
        Math.max(max, e.value.packet.payload.id), 0
      )
      const theoreticalStepCaptures = maxStepId > 0
        ? Math.floor((maxStepId + step_interval) / step_interval)
        : 0

      const stepCoverage = theoreticalStepCaptures > 0
        ? capturedStepPackets.length / theoreticalStepCaptures
        : null

      const epochCoverage = epochs > 0
        ? capturedEpochPackets.length / epochs
        : null

      const result = {
        session_id: sessionId,
        captured_step_packets: capturedStepPackets.length,
        captured_epoch_packets: capturedEpochPackets.length,
        theoretical_epoch_count: epochs,
        theoretical_step_captures: theoreticalStepCaptures,
        step_coverage_ratio: stepCoverage,
        epoch_coverage_ratio: epochCoverage
      }

      span.setAttributes({
        'coverage.step_ratio': stepCoverage ?? -1,
        'coverage.epoch_ratio': epochCoverage ?? -1
      })
      log.info({ event: 'session.coverage.calculated', session_id: sessionId, ...result })
      res.json(result)
    } catch (error) {
      console.log(error)
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      res.status(500).json({ error: error.message })
    } finally {
      span.end()
    }
  })
})

export default router
