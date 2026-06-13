import express from 'express'
import crypto from 'crypto'
import { getDB } from '../services/orbitdb.js'
import { getLogger } from '../tools/instrumentation.js'
import { trace, SpanStatusCode } from '@opentelemetry/api'

const router = express.Router()
const tracer = trace.getTracer('debug')
let pendingFault = null

// ── /debug/tamper ─────────────────────────────────────────────────────────────
router.post('/tamper', async (req, res) => {
  return tracer.startActiveSpan('debug.tamper', async (span) => {
    const log = getLogger()
    const { entry_id, tamper_type, fake_cid } = req.body
    try {
      const db = getDB()
      const entry = await db.get(entry_id).catch(() => null)
      if (!entry) return res.status(404).json({ error: `Entry not found: ${req.params.entry_id}` })

      const auditEntry = entry.value
      const tampered = JSON.parse(JSON.stringify(auditEntry))
      tampered._id = entry_id
      const randomHex = () => crypto.randomBytes(32).toString('hex')

      switch (tamper_type) {
        case 'packet_hash':
          tampered.packet_hash = randomHex(); break
        case 'step_loss':
          tampered.packet.payload.metrics.loss = Math.random() * 10; break
        case 'epoch_checkpoint_hash':
          tampered.packet.payload.checkpoint_hash = randomHex(); break
        case 'checkpoint_cid':
          if (!fake_cid) return res.status(400).json({ error: 'fake_cid required' })
          tampered.packet.payload.checkpoint_cid = fake_cid; break
        case 'session_merkle_root':
          tampered.packet.payload.dataset_merkle_root = randomHex(); break
        case 'dataset_cid':
          if (!fake_cid) return res.status(400).json({ error: 'fake_cid required' })
          tampered.packet.payload.dataset_cid = fake_cid; break
        case 'model_hash':
          tampered.packet.payload.model_hash = randomHex(); break
        case 'model_cid':
          if (!fake_cid) return res.status(400).json({ error: 'fake_cid required' })
          tampered.packet.payload.model_cid = fake_cid; break
        default:
          return res.status(400).json({ error: `Unknown tamper_type: ${tamper_type}` })
      }

      await db.put(tampered)
      span.setAttributes({ 'tamper.entry_id': entry_id, 'tamper.type': tamper_type })
      log.warn({ event: 'debug.tamper', entry_id, tamper_type })
      res.json({ status: 'tampered', entry_id, tamper_type })
    } catch (err) {
      span.recordException(err)
      span.setStatus({ code: SpanStatusCode.ERROR })
      res.status(500).json({ error: err.message })
    } finally {
      span.end()
    }
  })
})

// GET /debug/entry/:entry_id
router.get('/entry/:entry_id', async (req, res) => {
  try {
    const db = getDB()
    const entry = await db.get(req.params.entry_id).catch(() => null)
    if (!entry) return res.status(404).json({ error: `Entry not found: ${req.params.entry_id}` })
    res.json(entry.value)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /debug/restore
router.post('/restore', async (req, res) => {
  return tracer.startActiveSpan('debug.restore', async (span) => {
    const { entry_id, original_entry } = req.body
    try {
      const db = getDB()
      const restored = { ...original_entry, _id: entry_id }
      await db.put(restored)
      span.setAttributes({ 'restore.entry_id': entry_id })
      res.json({ status: 'restored', entry_id })
    } catch (err) {
      span.recordException(err)
      span.setStatus({ code: SpanStatusCode.ERROR })
      res.status(500).json({ error: err.message })
    } finally {
      span.end()
    }
  })
})

// ── /debug/inject-fault ───────────────────────────────────────────────────────
router.post('/inject-fault', (req, res) => {
  const log = getLogger()
  pendingFault = req.body   // { fault_type, target }
  log.warn({ event: 'debug.fault_armed', ...pendingFault })
  res.json({ status: 'fault armed', ...pendingFault })
})

export const consumeFault = () => {
  const f = pendingFault
  pendingFault = null
  return f
}

export default router