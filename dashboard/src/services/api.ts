const API_BASE_URL = 'http://localhost:3000';

export interface AuditPacket {
  _id: string;
  step_id: number;
  session_id: string;
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

export interface TrainingSession {
  session_id: string;
  start_time: string;
  end_time: string;
  steps: number;
}

export const fetchSessions = async (): Promise<TrainingSession[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit/sessions`);
    if (!response.ok) throw new Error('Failed to fetch training sessions');
    return await response.json();
  } catch (error) {
    console.error('[API Service Error] fetchSessions failed:', error);
    return [];
  }
};

export const fetchPackets = async (sessionId?: string): Promise<AuditPacket[]> => {
  try {
    const url = sessionId 
      ? `${API_BASE_URL}/audit/packets?session_id=${sessionId}`
      : `${API_BASE_URL}/audit/packets`;
    const response = await fetch(url);
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
