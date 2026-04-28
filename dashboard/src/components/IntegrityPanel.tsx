import React, { useState, useEffect } from 'react';
import { verifyStepIntegrity, type AuditPacket, type EpochSummary } from '../services/api';
import { Shield, Database, Cpu, Activity, AlertTriangle, Loader2 } from 'lucide-react';

interface IntegrityPanelProps {
  selectedPacket: AuditPacket | EpochSummary | null;
}

interface VerificationResult {
  is_valid: boolean;
  details?: {
    cid_match?: boolean;
    merkle_match?: boolean;
    local_cid?: string;
    blockchain_cid?: string;
  };
}

const IntegrityPanel: React.FC<IntegrityPanelProps> = ({ selectedPacket }) => {
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);

  // Reset verification status when node selection changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setVerificationResult(null);
      setVerifying(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedPacket]);

  const handleVerify = async () => {
    if (!selectedPacket) return;
    setVerifying(true);
    try {
      const result = await verifyStepIntegrity(selectedPacket.step_id);
      setVerificationResult(result);
    } catch (error) {
      console.error('[IntegrityPanel] Verification failed:', error);
      setVerificationResult({ is_valid: false });
    } finally {
      setVerifying(false);
    }
  };

  if (!selectedPacket) {
    return (
      <div className="integrity-panel">
        <div style={{ textAlign: 'center', marginTop: '50%', color: '#94a3b8' }}>
          <Activity size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
          <p>Select a training node to view cryptographic provenance</p>
        </div>
      </div>
    );
  }

  const isEpoch = 'epoch' in selectedPacket;
  const isVerified = verificationResult?.is_valid;
  const statusColor = verifying ? 'var(--warning)' : (isVerified === false ? 'var(--danger)' : 'var(--success)');
  
  const metrics = isEpoch ? selectedPacket.metrics : (selectedPacket as AuditPacket).runtime_data?.metrics;
  const packetHash = isEpoch ? 'N/A (Epoch Summary)' : (selectedPacket as AuditPacket).packet_hash;
  const datasetRoot = isEpoch ? 'N/A' : (selectedPacket as AuditPacket).provenance?.dataset_merkle_root;

  return (
    <div className="integrity-panel">
      <h2 style={{ color: 'var(--accent-cyan)', fontSize: '1.2rem', marginBottom: '0.5rem' }}>
        {isEpoch ? `EPOCH ${selectedPacket.epoch} DETAILS` : 'STEP PROVENANCE'}
      </h2>
      
      <div style={{ padding: '15px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          {verifying ? (
            <Loader2 size={18} className="animate-spin" color="var(--warning)" />
          ) : isVerified === false ? (
            <AlertTriangle size={18} color="var(--danger)" />
          ) : (
            <Shield size={18} color="var(--success)" />
          )}
          <span style={{ fontWeight: 'bold', color: statusColor }}>
            Status: {verifying ? 'VERIFYING...' : (isVerified === false ? 'INTEGRITY BREACH' : 'VERIFIED')}
          </span>
        </div>
        
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Timestamp: {new Date(selectedPacket.timestamp).toLocaleString()}
        </div>
      </div>

      <section>
        <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Database size={16} /> DECENTRALIZED STORAGE
        </h3>
        <div style={{ background: '#0a0b10', padding: '10px', borderRadius: '4px', border: '1px solid #1e293b' }}>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '0.7rem', color: '#64748b' }}>OrbitDB CID</label>
            <code style={{ fontSize: '0.75rem', wordBreak: 'break-all', color: 'var(--accent-cyan)' }}>{selectedPacket.cid || 'N/A'}</code>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: '#64748b' }}>{isEpoch ? 'Type' : 'Packet Hash'}</label>
            <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>{packetHash}</code>
          </div>
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={16} /> BLOCKCHAIN ANCHOR
        </h3>
        <div style={{ background: '#0a0b10', padding: '10px', borderRadius: '4px', border: '1px solid #1e293b' }}>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '0.7rem', color: '#64748b' }}>TX Hash</label>
            <code style={{ fontSize: '0.75rem', wordBreak: 'break-all', color: 'var(--accent-magenta)' }}>{selectedPacket.tx_hash || 'N/A'}</code>
          </div>
          {!isEpoch && (
            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', color: '#64748b' }}>Dataset Merkle Root</label>
              <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>{datasetRoot || 'N/A'}</code>
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Cpu size={16} /> {isEpoch ? 'EPOCH METRICS' : 'RUNTIME METRICS'}
        </h3>
        <div style={{ background: '#0a0b10', padding: '10px', borderRadius: '4px', border: '1px solid #1e293b' }}>
          <pre style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>
            {JSON.stringify(metrics, null, 2)}
          </pre>
        </div>
      </section>

      <button 
        className="btn-primary" 
        style={{ width: '100%', marginTop: 'auto' }}
        onClick={handleVerify}
        disabled={verifying}
      >
        {verifying ? 'VERIFYING...' : 'RE-VERIFY LINEAGE'}
      </button>
    </div>
  );
};

export default IntegrityPanel;
