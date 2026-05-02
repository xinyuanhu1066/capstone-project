import React, { useState, useEffect } from 'react';
import {
  verifyStepIntegrity,
  formatOnChainReceipt,
  formatStorageReceipt,
  type AuditPacket,
  type EpochSummary,
  type TrainingSession,
  type SelectionContext,
} from '../services/api';
import {
  Shield, Database, Cpu, Activity, AlertTriangle, Loader2
} from 'lucide-react';

interface IntegrityPanelProps {
  /** Structured selection context (session | epoch | step | null) */
  selectionContext?: SelectionContext;
  /** Legacy: kept for backward compat; ignored when selectionContext is provided */
  selectedPacket?: AuditPacket | EpochSummary | null;
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

// ─── Shared primitives ────────────────────────────────────────────────────────

const Row: React.FC<{ label: string; value: React.ReactNode; accent?: string }> = ({
  label, value, accent,
}) => (
  <div style={{ marginBottom: '10px' }}>
    <label style={{ display: 'block', fontSize: '0.68rem', color: '#64748b', marginBottom: '2px' }}>
      {label}
    </label>
    <code style={{ fontSize: '0.78rem', wordBreak: 'break-all', color: accent ?? 'var(--text-primary)', display: 'block' }}>
      {value}
    </code>
  </div>
);

const Card: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({
  title, icon, children,
}) => (
  <section>
    <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      {icon} {title}
    </h3>
    <div style={{ background: '#0a0b10', padding: '12px', borderRadius: '4px', border: '1px solid #1e293b' }}>
      {children}
    </div>
  </section>
);

// ─── SESSION panel ────────────────────────────────────────────────────────────

const SessionPanel: React.FC<{ session: TrainingSession }> = ({ session }) => {
  const datasetLabel = session.dataset_name
    ? `${session.dataset_name}${session.dataset_version ? ` v${session.dataset_version}` : ''}`
    : 'N/A';

  return (
    <>
      <h2 style={{ color: 'var(--accent-cyan)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
        Session Overview
      </h2>

      <Card title="" icon={null}>
        <Row label="Session ID" value={session.session_id} />
        <Row label="Dataset" value={datasetLabel} />
        <Row label="Total Steps" value={String(session.steps)} />
        <Row
          label="Duration"
          value={`${new Date(session.start_time).toLocaleString()} → ${new Date(session.end_time).toLocaleString()}`}
        />
        <Row label="Hyperparams" value={String(session.hyperparams)} />
      </Card>
    </>
  );
};

// ─── EPOCH panel ─────────────────────────────────────────────────────────────

const EpochPanel: React.FC<{ epoch: EpochSummary }> = ({ epoch }) => {
  const storageReceipt = formatStorageReceipt(epoch.checkpoint_cid);
  const onChainReceipt = formatOnChainReceipt(epoch.tx_hash, epoch.block_number);

  return (
    <>
      <h2 style={{ color: 'var(--accent-cyan)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
        EPOCH {epoch.epoch}
      </h2>

      <Card title='' icon={null}>
        <Row label="Session" value={epoch.session_id} />
        <Row label="Ending Step" value={`#${epoch.step_id}`} />
      </Card>

      <Card title="Decentralised Storage for Checkpoint" icon={<Database size={15} />}>
        <Row
          label="Off-Chain Receipt"
          value={storageReceipt}
        />
      </Card>

      <Card title="Blockchain Anchor for Checkpoint" icon={<Shield size={15} />}>
        <Row
          label="On-Chain Receipt"
          value={onChainReceipt}
        />
      </Card>
    </>
  );
};

// ─── STEP panel ───────────────────────────────────────────────────────────────

const StepPanel: React.FC<{
  packet: AuditPacket;
  verifying: boolean;
  verificationResult: VerificationResult | null;
  onVerify: () => void;
}> = ({ packet, verifying, verificationResult, onVerify }) => {
  const isVerified = verificationResult?.is_valid;
  const statusColor = verifying
    ? 'var(--warning)'
    : isVerified === false
    ? 'var(--danger)'
    : 'var(--success)';

  const storageReceipt = formatStorageReceipt(packet.cid);
  const onChainReceipt = formatOnChainReceipt(packet.tx_hash);

  return (
    <>
      <h2 style={{ color: 'var(--accent-cyan)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
        STEP #{packet.step_id}
      </h2>

      {/* Status badge */}
      <div style={{
        padding: '10px 14px',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        background: 'rgba(255,255,255,0.02)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        {verifying ? (
          <Loader2 size={16} className="animate-spin" color="var(--warning)" />
        ) : isVerified === false ? (
          <AlertTriangle size={16} color="var(--danger)" />
        ) : (
          <Shield size={16} color="var(--success)" />
        )}
        <div>
          <span style={{ fontWeight: 700, color: statusColor, fontSize: '0.85rem' }}>
            {verifying ? 'VERIFYING…' : isVerified === false ? 'INTEGRITY BREACH' : 'VERIFIED'}
          </span>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            {new Date(packet.timestamp).toLocaleString()}
          </div>
        </div>
      </div>

      <Card title="Decentralised Storage for Metrics" icon={<Database size={15} />}>
        <Row
          label="Off-Chain Receipt"
          value={storageReceipt}
        />
      </Card>

      <Card title="Blockchain Anchor for Metrics" icon={<Shield size={15} />}>
        <Row
          label="On-Chain Receipt"
          value={onChainReceipt}
        />
      </Card>

      <Card title="Metrics" icon={<Cpu size={15} />}>
        <pre style={{ fontSize: '0.75rem', color: 'var(--text-primary)', margin: 0 }}>
          {JSON.stringify(packet.metrics, null, 2)}
        </pre>
      </Card>

      <button
        className="btn-primary"
        style={{ width: '100%', marginTop: 'auto' }}
        onClick={onVerify}
        disabled={verifying}
      >
        {verifying ? 'VERIFYING…' : 'RE-VERIFY LINEAGE'}
      </button>
    </>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────

const IntegrityPanel: React.FC<IntegrityPanelProps> = ({
  selectionContext,
  selectedPacket,
}) => {
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);

  // Resolve context — prefer new prop, fall back to legacy
  const resolved: SelectionContext = selectionContext !== null
    ? selectionContext
    : selectedPacket
      ? 'epoch' in selectedPacket
        ? { type: 'epoch', data: selectedPacket as EpochSummary }
        : { type: 'step',  data: selectedPacket as AuditPacket }
      : null;

  useEffect(() => {
    const t = setTimeout(() => { setVerificationResult(null); setVerifying(false); }, 0);
    return () => clearTimeout(t);
  }, [resolved]);

  const handleVerify = async () => {
    if (!resolved || resolved.type !== 'step') return;
    setVerifying(true);
    try {
      const result = await verifyStepIntegrity(resolved.data.step_id);
      setVerificationResult(result);
    } catch {
      setVerificationResult({ is_valid: false });
    } finally {
      setVerifying(false);
    }
  };

  if (!resolved) {
    return (
      <div className="integrity-panel">
        <div style={{ textAlign: 'center', marginTop: '50%', color: '#94a3b8' }}>
          <Activity size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
          <p>Select a session, epoch, or step node to view cryptographic provenance</p>
        </div>
      </div>
    );
  }

  return (
    <div className="integrity-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {resolved.type === 'session' && <SessionPanel session={resolved.data} />}
      {resolved.type === 'epoch'   && <EpochPanel   epoch={resolved.data} />}
      {resolved.type === 'step'    && (
        <StepPanel
          packet={resolved.data}
          verifying={verifying}
          verificationResult={verificationResult}
          onVerify={handleVerify}
        />
      )}
    </div>
  );
};

export default IntegrityPanel;
