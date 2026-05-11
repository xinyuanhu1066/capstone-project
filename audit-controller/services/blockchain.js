import { ethers } from 'ethers'
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api'
import { getLogger } from '../tools/instrumentation.js'

const tracer = trace.getTracer('blockchain')
const meter = metrics.getMeter('blockchain')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

// Configuration (can be overridden by env vars)
const GANACHE_URL = process.env.GANACHE_URL
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS
const PRIVATE_KEY = process.env.PRIVATE_KEY

const ABI = [
  "function startSession(bytes32 _sessionId, bytes32 _merkleRoot) external",
  "function syncProgress(bytes32 _sessionId, bytes32 _packetHash, uint256 _stepId) external",
  "function completeSession(bytes32 _sessionId, bytes32 _finalPacketHash) external",
  "function getSession(bytes32 _sessionId) external view returns (bytes32 datasetMerkleRoot, bytes32 latestPacketHash, bool isActive, bool isCompleted)",
  "event SessionStarted(bytes32 indexed sessionId, bytes32 merkleRoot, uint256 timestamp)",
  "event AuditAnchored(bytes32 indexed sessionId, bytes32 packetHash, uint256 stepId, uint256 timestamp)",
  "event SessionCompleted(bytes32 indexed sessionId, bytes32 finalPacketHash, uint256 timestamp)"
]

let provider = null
let wallet = null
let contract = null
let txQueue = Promise.resolve()
let currentNonce = null

const gasCounter = meter.createCounter('blockchain.gas_used_total', {
  description: 'Total gas consumed by blockchain transactions'
})

const txLatencyHistogram = meter.createHistogram('blockchain.tx_duration_ms', {
  description: 'Blockchain transaction confirmation latency'
})

const sendWithLock = (fn) => {
  const result = txQueue.then(() => fn())
  txQueue = result.catch(() => {})
  return result
}

const sendTx = async (fn) => {
  return sendWithLock(async () => {
    return tracer.startActiveSpan('blockchain.sendTx', async (span) => {
      const txStart = Date.now()
      try {
        if (currentNonce === null) {
          currentNonce = await provider.getTransactionCount(wallet.address, 'latest')
        }
        const nonce = currentNonce
        const result = await fn(nonce)
        currentNonce++

        const txDuration = Date.now() - txStart
        txLatencyHistogram.record(txDuration)
        span.setStatus({ code: SpanStatusCode.OK })

        return result
      } catch (err) {
        currentNonce = null
        span.recordException(err)
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw err
      } finally {
        span.end()
      }
    })
  })
}

const toBytes32Hex = (h) => {
  if (!h) return '0x' + '0'.repeat(64)
  return h.startsWith('0x') ? h : '0x' + h
}

const sessionIdToBytes32 = (sid) => {
  // If already a 0x-prefixed 32-byte hex, return as-is, otherwise keccak256-hash the identifier to get a bytes32
  if (!sid) return ethers.ZeroHash
  if (sid.startsWith('0x') && sid.length === 66) return sid
  return ethers.id(sid)
}

export const initBlockchain = async () => {
  try {
    provider = new ethers.JsonRpcProvider(GANACHE_URL)
    wallet = new ethers.Wallet(PRIVATE_KEY, provider)
    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet)

    console.log('[Blockchain Service] Connected to Ganache. Wallet:', await wallet.getAddress())
    return { contract, wallet }
  } catch (error) {
    console.error('[Blockchain Service Error] Initialization failed:', error)
    throw error
  }
}

export const startSession = async (sessionId, merkleRootHex) => {
  return tracer.startActiveSpan('blockchain.startSession', async (span) => {
    span.setAttributes({ 'session.id': sessionId, 'session.action': 'start' })
    try {
      const sid = sessionIdToBytes32(sessionId)
      const mr = toBytes32Hex(merkleRootHex)
      return await sendTx(async (nonce) => {
        const tx = await contract.startSession(sid, mr, { nonce })
        const receipt = await tx.wait()
        const gasUsed = Number(receipt.gasUsed ?? 0)
        span.setAttributes({ 'tx.hash': receipt.hash, 'tx.nonce': nonce, 'tx.gas_used': gasUsed })
        gasCounter.add(gasUsed, { method: 'startSession', session_id: sessionId })
        return receipt.hash
      })
    } catch (err) {
      span.recordException(err)
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw err
    } finally {
      span.end()
    }
  })
}

export const syncProgress = async (sessionId, lastPacketHashHex, stepId) => {
  return tracer.startActiveSpan('blockchain.syncProgress', async (span) => {
    span.setAttributes({ 'session.id': sessionId, 'step.id': stepId })
    try {
      const sid = sessionIdToBytes32(sessionId)
      const lh = toBytes32Hex(lastPacketHashHex)
      return await sendTx(async (nonce) => {
        const tx = await contract.syncProgress(sid, lh, stepId, { nonce })
        const receipt = await tx.wait()
        const gasUsed = Number(receipt.gasUsed ?? 0)
        span.setAttributes({ 'tx.hash': receipt.hash, 'tx.nonce': nonce, 'tx.gas_used': gasUsed })
        gasCounter.add(gasUsed, { method: 'syncProgress', session_id: sessionId })
        return receipt.hash
      })
    } catch (err) {
      span.recordException(err)
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw err
    } finally {
      span.end()
    }
  })
}

export const completeSession = async (sessionId, finalPacketHashHex) => {
  return tracer.startActiveSpan('blockchain.completeSession', async (span) => {
    span.setAttributes({ 'session.id': sessionId, 'session.action': 'end' })
    try {
      const sid = sessionIdToBytes32(sessionId)
      const fh = toBytes32Hex(finalPacketHashHex)
      return sendTx(async (nonce) => {
        const tx = await contract.completeSession(sid, fh, { nonce })
        const receipt = await tx.wait()
        const gasUsed = Number(receipt.gasUsed ?? 0)
        span.setAttributes({ 'tx.hash': receipt.hash, 'tx.nonce': nonce, 'tx.gas_used': gasUsed })
        gasCounter.add(gasUsed, { method: 'completeSession', session_id: sessionId })
        return receipt.hash
      })
    } catch (err) {
      span.recordException(err)
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw err
    } finally {
      span.end()
    }
  })
}

export const getSession = async (sessionId) => {
  return tracer.startActiveSpan('blockchain.getSession', async (span) => {const sid = sessionIdToBytes32(sessionId)
    try {
      const s = await contract.getSession(sid)
      // s may be an array-like result
      return {
        datasetMerkleRoot: s.datasetMerkleRoot ?? s[0],
        latestPacketHash: s.latestPacketHash ?? s[1],
        isActive: s.isActive ?? s[2],
        isCompleted: s.isCompleted ?? s[3]
      }
    } finally {
      span.end()
    }
  })
}

export const getAnchorsFromChain = async (sessionId, blockHeight) => {
  return tracer.startActiveSpan('blockchain.getAnchorsFromChain', async (span) => {
    try {
      const sid = sessionIdToBytes32(sessionId)

      // AuditAnchored events (steps & epochs)
      const auditFilter = contract.filters.AuditAnchored(sid)
      const auditLogs = await contract.queryFilter(auditFilter, blockHeight)

      const anchorMap = {}
      auditLogs.forEach(log => {
        const { packetHash, stepId } = log.args
        anchorMap[Number(stepId)] = packetHash
      })

      // SessionStarted event
      const startFilter = contract.filters.SessionStarted(sid)
      const startLogs = await contract.queryFilter(startFilter, blockHeight)
      const sessionStartMerkleRoot = startLogs.length > 0 ? startLogs[0].args.merkleRoot : null

      return { anchorMap, sessionStartMerkleRoot }
    } finally {
      span.end()
    }
  })
}

export const getBlockHeight = async () => {
  return tracer.startActiveSpan('blockchain.getBlockHeight', async (span) => {
    try {
      const currentBlockHeight = await provider.getBlockNumber()
      return currentBlockHeight
    } finally {
      span.end()
    }
  })
}

/**
 * Get block number by transaction hash
 * @param {string} txHash - Transaction hash (0x...)
 * @returns {Promise<number>} - Block number
 */
export const getBlockNumberByTxHash = async (txHash) => {
  return tracer.startActiveSpan('blockchain.getBlockNumberByTxHash', async (span) => {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        const err = new Error('Transaction receipt not found. The tx might be pending.')
        span.recordException(err)
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw err
      }

      return receipt.blockNumber;
    } catch (error) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw error;
    } finally {
      span.end()
    }
  })
}