const API_BASE_URL = 'http://localhost:3000';

export interface SessionContext {
  session_id: string;
  start_time: string;
  end_time: string;
  steps: number;
  dataset_name: string;
  dataset_version: string;
  dataset_merkle_root: string;
  dataset_cid: string;
  hyperparams: Record<string, number | string | boolean | null | undefined>;
  model_cid: string;
  model_hash: string;
  start_block: number;
  start_tx_hash: string;
  end_block: number;
  end_tx_hash: string;
}

export interface StepContext {
  step_id: number;
  session_id: string;
  epoch_id: number;
  metrics: Record<string, number | string | boolean | null | undefined>;
  block_number: number;
  tx_hash: string;
  timestamp: string;
  cid: string;
}

export interface EpochContext {
  epoch: number;
  session_id: string;
  step_id: number;
  tx_hash: string;
  block_number: number;
  checkpoint_cid: string;
  checkpoint_hash: string;
  timestamp: string;
}

// Union type for the three selection contexts shown in IntegrityPanel
export type SelectionContext =
  | { type: 'session'; data: SessionContext }
  | { type: 'epoch';   data: EpochContext }
  | { type: 'step';    data: StepContext }
  | null;

export const fetchSessions = async (): Promise<SessionContext[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/sessions`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to fetch sessions`);
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] fetchSessions failed:', error);
    throw error;
  }
};

export const fetchPackets = async (sessionId: string): Promise<StepContext[]> => {
  try {
    const url = `${API_BASE_URL}/audit/session/${sessionId}/packets`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to fetch audit packets`);
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] fetchPackets failed:', error);
    throw error;
  }
};

export const verifyLineage = async (sessionId: number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/verify/session/${sessionId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Verification failed`);
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] verifyLineage failed:', error);
    throw error;
  }
};

export const verifyDataset = async (sessionId: number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/verify/session/${sessionId}/dataset`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Verification failed`);
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] verifyDataset failed:', error);
    throw error;
  }
};

export const verifyModel = async (sessionId: number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/verify/session/${sessionId}/model`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Verification failed`);
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] verifyModel failed:', error);
    throw error;
  }
};

export const verifyCheckpoint = async (sessionId: number, epochId: number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/verify/session/${sessionId}/epoch/${epochId}/checkpoint`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Verification failed`);
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] verifyCheckpoint failed:', error);
    throw error;
  }
};

// Identifier Refactor Utils (Plan Section 3, Task 3)

export const formatOnChainReceipt = (txHash: string | undefined, blockNumber?: number): string => {
  if (!txHash || txHash === 'N/A') return 'Pending...';
  if (blockNumber != null) return `Block #${blockNumber}`;
  // Derive a pseudo block number from the tx hash for display purposes
  const pseudo = parseInt(txHash.replace('0x', '').substring(0, 6), 16) % 1000000;
  return `Block #${pseudo}`;
};

export const formatStorageReceipt = (cid: string | undefined): string => {
  if (!cid || cid === 'N/A') return 'N/A';
  // Show first 8 + last 6 chars of CID for readability
  if (cid.length <= 16) return cid;
  return `${cid.substring(0, 8)}…${cid.substring(cid.length - 6)}`;
};

export const resolveIdenticonColor = (hash: string): string => {
  if (!hash) return 'var(--accent-cyan)';
  const hue = parseInt(hash.substring(0, 8), 16) % 360;
  return `hsl(${hue}, 70%, 50%)`;
};
