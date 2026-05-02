const API_BASE_URL = 'http://localhost:3000';

export interface AuditPacket {
  _id: string;
  step_id: number;
  session_id: string;
  epoch_id?: number;
  metrics_hash: string;
  metrics: Record<string, number | string | boolean | null | undefined>;
  packet_hash: string;
  tx_hash?: string;
  timestamp: string;
}

export interface TrainingSession {
  session_id: string;
  start_time: string;
  end_time: string;
  steps: number;
  last_updated?: string;
  // Dataset metadata lives at the session level (not repeated per step)
  dataset_name?: string;
  dataset_version?: string;
  dataset_merkle_root?: string;
  dataset_cid?: string;
  hyperparams_hash?: string;
  hyperparams: Record<string, number | string | boolean | null | undefined>;
}

// Union type for the three selection contexts shown in IntegrityPanel
export type SelectionContext =
  | { type: 'session'; data: TrainingSession }
  | { type: 'epoch';   data: EpochSummary }
  | { type: 'step';    data: AuditPacket }
  | null;

export interface EpochSummary {
  epoch: number;
  session_id: string;
  step_id: number;
  tx_hash: string;
  block_number?: number;
  checkpoint_cid?: string;
  checkpoint_hash?: string;
  timestamp: string;
}

export const fetchSessions = async (): Promise<TrainingSession[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/sessions`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to fetch sessions`);
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] fetchSessions failed:', error);
    throw error;
  }
};

export const fetchPackets = async (sessionId?: string): Promise<AuditPacket[]> => {
  try {
    const url = sessionId 
      ? `${API_BASE_URL}/audit/packets?session_id=${sessionId}`
      : `${API_BASE_URL}/audit/packets`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to fetch audit packets`);
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] fetchPackets failed:', error);
    throw error;
  }
};

export const verifyStepIntegrity = async (stepId: number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/verify/${stepId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Verification failed`);
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] verifyStepIntegrity failed:', error);
    throw error;
  }
};

export const fetchEpochs = async (sessionId: string): Promise<EpochSummary[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/epochs?session_id=${sessionId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to fetch epochs`);
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] fetchEpochs failed:', error);
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
