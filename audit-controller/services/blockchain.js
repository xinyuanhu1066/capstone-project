import { ethers } from 'ethers'

// Configuration
const GANACHE_URL = 'http://127.0.0.1:7545'
const CONTRACT_ADDRESS = '0x98b44496a891e1Ee623868AAAc73097E294FDD9f'
const PRIVATE_KEY = '0x22dbf5fbc9ab68f210c461c5b9b50a58006c484342617bcebfd2aff6a7d8b683'

const ABI = [
  "function anchorRecord(uint256 _stepId, string memory _orbitdbCid, string memory _datasetMerkleRoot) public",
  "function getRecord(uint256 _stepId) public view returns (tuple(uint256 stepId, string orbitdbCid, string datasetMerkleRoot, uint256 timestamp))",
  "event RecordAnchored(uint256 indexed stepId, string orbitdbCid, string datasetMerkleRoot)"
]

let provider = null
let wallet = null
let contract = null

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

export const anchorToBlockchain = async (stepId, orbitdbCid, datasetMerkleRoot) => {
  if (!contract) throw new Error('Blockchain service not initialized')

  try {
    console.log(`[Blockchain Service] Anchoring step ${stepId} to smart contract...`)
    const tx = await contract.anchorRecord(stepId, orbitdbCid, datasetMerkleRoot)
    const receipt = await tx.wait()
    
    console.log(`[Blockchain Service] Transaction confirmed! Hash: ${receipt.hash}`)
    return receipt.hash
  } catch (error) {
    console.error('[Blockchain Service Error] Anchoring failed:', error)
    throw error
  }
}

export const getRecordFromBlockchain = async (stepId) => {
  if (!contract) throw new Error('Blockchain service not initialized')
  return await contract.getRecord(stepId)
}
