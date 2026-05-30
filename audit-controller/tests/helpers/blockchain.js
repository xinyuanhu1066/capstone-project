import { jest } from '@jest/globals'

/**
 * Returns Jest mock implementations for every blockchain function
 * imported by audit.js.  Call resetBlockchainMocks() between tests.
 */
export function createBlockchainMocks() {
  // In-memory session state (mirrors what the smart contract would store)
  const sessions = new Map()
  let fakeBlockHeight = 1000

  return {
    // Called for session-start packets
    startSession: jest.fn(async (sessionId, datasetMerkleRoot) => {
      sessions.set(sessionId, {
        sessionId,
        datasetMerkleRoot,
        latestPacketHash: '',
        isActive: true,
        isCompleted: false,
      })
      return `0xtx-start-${sessionId.slice(-8)}`
    }),

    // Called for step and epoch packets
    syncProgress: jest.fn(async (sessionId, packetHash, stepId) => {
      const s = sessions.get(sessionId)
      if (s) s.latestPacketHash = packetHash
      return `0xtx-step-${stepId}`
    }),

    // Called for session-end packets
    completeSession: jest.fn(async (sessionId, finalPacketHash) => {
      const s = sessions.get(sessionId)
      if (s) {
        s.latestPacketHash = finalPacketHash
        s.isCompleted = true
      }
      return `0xtx-end-${sessionId.slice(-8)}`
    }),

    // Called by GET /verify/session/:id
    getSession: jest.fn(async (sessionId) => {
      return sessions.get(sessionId) ?? null
    }),

    // Called by GET /verify/session/:id  (full lineage verify)
    getAnchorsFromChain: jest.fn(async (sessionId, blockHeight) => {
      const s = sessions.get(sessionId)
      return {
        anchorMap: {},   // step_id → on-chain hash; fill in per-test
        sessionStartMerkleRoot: s?.datasetMerkleRoot ?? '',
      }
    }),

    // Called once per session-start packet write
    getBlockHeight: jest.fn(async () => {
      return fakeBlockHeight++
    }),

    // Called when building session list / packet list responses
    getBlockNumberByTxHash: jest.fn(async (txHash) => {
      if (!txHash || txHash === 'N/A') return -1
      return 12345
    }),

    // Test helpers
    _sessions: sessions,
    _reset() {
      sessions.clear()
      fakeBlockHeight = 1000
      ;[
        'startSession', 'syncProgress', 'completeSession',
        'getSession', 'getAnchorsFromChain', 'getBlockHeight',
        'getBlockNumberByTxHash'
      ].forEach(fn => this[fn].mockClear())
    }
  }
}