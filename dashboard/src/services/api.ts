const API_BASE_URL = 'http://localhost:3000';

export interface AuditPacket {
  _id: string;
  step_id: number;
  provenance: {
    dataset_merkle_root: string;
    weights_sha256: string;
    hyperparams_sha256: string;
    metrics_sha256: string;
  };
  runtime_data: {
    metrics: Record<string, any>;
    hyperparams: Record<string, any>;
  };
  packet_hash: string;
  cid?: string;
  tx_hash?: string;
  timestamp: string;
}

export const fetchPackets = async (): Promise<AuditPacket[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/packets`);
    if (!response.ok) throw new Error('Failed to fetch audit packets');
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] fetchPackets failed:', error);
    return [];
  }
};

export const verifyStepIntegrity = async (stepId: number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/verify/${stepId}`);
    if (!response.ok) throw new Error('Verification failed');
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] verifyStepIntegrity failed:', error);
    return { is_valid: false, error: 'Connection failed' };
  }
};
