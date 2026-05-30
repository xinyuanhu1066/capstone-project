import { jest } from '@jest/globals'

// ─── 1. Mock the two service modules BEFORE importing the app ─────────────────
//  Jest hoists jest.mock() calls, so these run before any imports.

import { createInMemoryDB }     from './helpers/db.js'
import { createHeliaStub }      from './helpers/helia.js'
import { createBlockchainMocks } from './helpers/blockchain.js'

const db       = createInMemoryDB()
const { helia, heliaFs } = createHeliaStub()
const bcMocks  = createBlockchainMocks()

// Replace the service modules entirely
jest.unstable_mockModule('../services/orbitdb.js', () => ({
  getDB:    jest.fn(() => db),
  getHelia: jest.fn(() => helia),
}))

const orbitdbMock = await import('../services/orbitdb.js')

// Also mock the unixfs wrapper (used in POST /blob)
jest.unstable_mockModule('@helia/unixfs', () => ({
  unixfs: jest.fn(() => heliaFs),
}))

jest.unstable_mockModule('../services/blockchain.js', () => bcMocks)

// ─── 2. Now import the app (after mocks are in place) ─────────────────────────
const { default: express } = await import('express')
const { default: request }  = await import('supertest')
const { default: auditRouter } = await import('../routes/audit.js')

const app = express()
app.use(express.json())
app.use('/audit', auditRouter)

// ─── 3. Reset between tests ───────────────────────────────────────────────────
beforeEach(() => {
  db._reset()
  bcMocks._reset()
})

// ─── 4. Write tests ───────────────────────────────────────────────────────────

// --- Helpers ------------------------------------------------------------------

function makePacket(overrides = {}) {
  return {
    session_id: 'session-test-abc',
    type:       'step',
    action:     '',
    prev_hash:  '0'.repeat(64),
    payload: {
      id:      1,
      metrics: { loss: 0.5 },
    },
    ...overrides,
  }
}

// Compute a realistic packet hash (mirrors your hashlib.js logic)
import crypto from 'crypto'
function hashPacket(packet) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(packet))
    .digest('hex')
}

// --- POST /audit/packet -------------------------------------------------------

describe('POST /audit/packet', () => {
  it('accepts a valid step packet and returns 201 + tx_hash', async () => {
    const packet      = makePacket()
    const packet_hash = hashPacket(packet)

    const res = await request(app)
      .post('/audit/packet')
      .send({ packet, packet_hash })

    expect(res.status).toBe(201)
    expect(res.body.tx_hash).toMatch(/^0xtx-step-/)
    expect(bcMocks.syncProgress).toHaveBeenCalledWith('session-test-abc', packet_hash, 1)
  })

  it('stores the packet in OrbitDB after successful anchoring', async () => {
    const packet      = makePacket({ payload: { id: 42, metrics: {} } })
    const packet_hash = hashPacket(packet)

    await request(app).post('/audit/packet').send({ packet, packet_hash })

    expect(db._size()).toBe(1)
  })

  it('anchors session-start via startSession()', async () => {
    const packet = makePacket({
      type:   'session',
      action: 'start',
      payload: {
        dataset_merkle_root: 'abcdef1234',
        dataset_name:        'MNIST',
        dataset_version:     'v1.0',
        dataset_cid:         'bafytest',
        hyperparams:         { lr: 0.01 },
      }
    })

    await request(app).post('/audit/packet').send({ packet, packet_hash: hashPacket(packet) })

    expect(bcMocks.startSession).toHaveBeenCalledWith('session-test-abc', 'abcdef1234')
    expect(bcMocks.syncProgress).not.toHaveBeenCalled()
  })

  it('anchors session-end via completeSession()', async () => {
    const packet      = makePacket({ type: 'session', action: 'end', payload: { model_cid: 'bafymodel', model_hash: 'deadbeef' } })
    const packet_hash = hashPacket(packet)

    await request(app).post('/audit/packet').send({ packet, packet_hash })

    expect(bcMocks.completeSession).toHaveBeenCalledWith('session-test-abc', packet_hash)
  })

  it('returns 500 and does not write to OrbitDB when blockchain fails', async () => {
    bcMocks.syncProgress.mockRejectedValueOnce(new Error('RPC timeout'))

    const packet = makePacket()
    const res    = await request(app).post('/audit/packet').send({ packet, packet_hash: hashPacket(packet) })

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/blockchain anchoring failed/i)
    expect(db._size()).toBe(0)   // OrbitDB must NOT be written if anchoring failed
  })
})

// --- POST /audit/blob ---------------------------------------------------------

describe('POST /audit/blob', () => {
  it('stores bytes and returns a CID', async () => {
    const buf = Buffer.from('hello provenance')
    const res = await request(app)
      .post('/audit/blob')
      .set('Content-Type', 'application/octet-stream')
      .send(buf)

    expect(res.status).toBe(201)
    expect(res.body.cid).toBeTruthy()
  })

  it('returns 503 when Helia is not initialized', async () => {
    const { getHelia } = await import('../services/orbitdb.js')
    getHelia.mockReturnValueOnce(null)

    const res = await request(app)
      .post('/audit/blob')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'))

    expect(res.status).toBe(503)
  })
})

// --- POST /audit/dataset/version ----------------------------------------------

describe('POST /audit/dataset/version', () => {
  it('returns v1.0 for a new dataset', async () => {
    const res = await request(app)
      .post('/audit/dataset/version')
      .send({ dataset_name: 'MNIST', merkle_root: 'root-aaa' })

    expect(res.status).toBe(200)
    expect(res.body.version).toBe('v1.0')
  })

  it('returns the same version when the merkle root has not changed', async () => {
    await request(app).post('/audit/dataset/version').send({ dataset_name: 'MNIST', merkle_root: 'root-aaa' })
    const res = await request(app).post('/audit/dataset/version').send({ dataset_name: 'MNIST', merkle_root: 'root-aaa' })

    expect(res.body.version).toBe('v1.0')
  })

  it('increments the minor version when the merkle root changes', async () => {
    await request(app).post('/audit/dataset/version').send({ dataset_name: 'MNIST', merkle_root: 'root-aaa' })
    const res = await request(app).post('/audit/dataset/version').send({ dataset_name: 'MNIST', merkle_root: 'root-bbb' })

    expect(res.body.version).toBe('v1.1')
  })
})

// --- GET /audit/sessions ------------------------------------------------------

describe('GET /audit/sessions', () => {
  async function seedSession(sessionId, { startTime = new Date().toISOString() } = {}) {
    const startPacket = {
      _id:        `session-start-${sessionId}`,
      packet:     { session_id: sessionId, type: 'session', action: 'start', payload: { dataset_name: 'MNIST', dataset_version: 'v1.0', dataset_merkle_root: 'root-x', dataset_cid: 'bafy', hyperparams: {} } },
      packet_hash: 'hash-start',
      tx_hash:    `0xtx-start-${sessionId}`,
      timestamp:  startTime,
    }
    await db.put(startPacket)
  }

  it('returns an empty array when there are no sessions', async () => {
    const res = await request(app).get('/audit/sessions')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('includes seeded sessions in the response', async () => {
    await seedSession('session-111')
    const res = await request(app).get('/audit/sessions')
    expect(res.body.some(s => s.session_id === 'session-111')).toBe(true)
  })

  it('sorts sessions newest-first', async () => {
    await seedSession('session-old', { startTime: '2024-01-01T00:00:00Z' })
    await seedSession('session-new', { startTime: '2024-06-01T00:00:00Z' })

    const res  = await request(app).get('/audit/sessions')
    const ids  = res.body.map(s => s.session_id)
    expect(ids.indexOf('session-new')).toBeLessThan(ids.indexOf('session-old'))
  })
})