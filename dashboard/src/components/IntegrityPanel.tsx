import React, { useState, useEffect } from 'react';
import {
  verifyLineage,
  verifyDataset,
  verifyModel,
  verifyCheckpoint,
  formatOnChainReceipt,
  formatStorageReceipt,
  type StepContext,
  type EpochContext,
  type SessionContext,
  type SelectionContext,
} from '../services/api';
import {
  Shield, Database, Cpu, Activity, AlertTriangle, Loader2,
  Brain
} from 'lucide-react';
import Tooltip from './Tooltip';

interface StepNodeData {
  stepId: number;
  fullData: StepContext;
  isFirstInSeq: boolean;
  isLastInSeq: boolean;
  isRowEnd: boolean;
  isOddRow: boolean;
  posInRow: number;
}

interface IntegrityPanelProps {
  /** Structured selection context (session | epoch | step | null) */
  selectionContext?: SelectionContext;
  /** Legacy: kept for backward compat; ignored when selectionContext is provided */
  selectedNode?: StepNodeData | EpochContext | null;
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

const formatDuration = (start: string, end: string) => {
  const diff = Math.abs(new Date(end).getTime() - new Date(start).getTime());
  
  const seconds = Math.floor((diff / 1000) % 60);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0 || seconds > 0) parts.push(`${seconds}s`);

  return parts.join(' ');
};

const SessionPanel: React.FC<{
  session: SessionContext;
  verifying: boolean;
  onVerify: () => void;
}> = ({ session, verifying, onVerify }) => {
  const datasetLabel = session.dataset_name
    ? `${session.dataset_name}${session.dataset_version ? ` ${session.dataset_version}` : ''}`
    : 'N/A';

  return (
    <>
      <h2 style={{ color: 'var(--accent-cyan)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
        Session Overview
      </h2>

      <Card title="" icon={null}>
        <Row label="Session ID" value={session.session_id} />
        <Row label="Total Steps" value={String(session.steps)} />
        <Row
          label="Duration"
          value={
            <Tooltip content={
              <div style={{
                display: 'grid', 
                gridTemplateColumns: 'auto 1fr',
                gap: '4px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px'
              }}>
                <span style={{ color: '#64748b' }}>START:</span>
                <span style={{ color: '#fff' }}>{new Date(session.start_time).toLocaleString()}</span>
                
                <span style={{ color: '#64748b' }}>END:</span>
                <span style={{ color: '#fff' }}>{new Date(session.end_time).toLocaleString()}</span>
              </div>
            }>
              <span style={{ cursor: 'pointer' }}>
                {formatDuration(session.start_time, session.end_time)}
              </span>
            </Tooltip>
          }
        />
        <Row 
          label="Hyperparams" 
          value={
            <pre style={{ 
              fontSize: '10px', 
              background: 'rgba(0,0,0,0.3)', 
              padding: '6px', 
              borderRadius: '4px',
              margin: '4px 0',
              // color: '#94a3b8',
              border: '1px solid #1e293b',
              maxHeight: '120px',
              overflowY: 'auto',
              overflowX: 'hidden',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}>
              {JSON.stringify(session.hyperparams, null, 2)}
            </pre>
          } 
        />
      </Card>

      <Card title="Dataset" icon={<Database size={15} />}>
        <Row label="Version" value={datasetLabel} />
        <Row
          label="On-Chain Receipt"
          value={
            <Tooltip
              copyValue={session.start_tx_hash}
              content={
                <div style={{ wordBreak: 'break-all', maxWidth: '240px', color: '#94a3b8', lineHeight: '1.4' }}>
                  {session.start_tx_hash}
                </div>
              }
            >
              <span style={{ cursor: 'pointer' }}>
                {formatOnChainReceipt(session.start_tx_hash, session.start_block_number)}
              </span>
            </Tooltip>
          }
        />
        <Row
          label="Off-Chain Receipt"
          value={
            <Tooltip
              copyValue={session.dataset_cid}
              content={
                <div style={{ wordBreak: 'break-all', maxWidth: '240px', color: '#94a3b8', lineHeight: '1.4' }}>
                  {session.dataset_cid}
                </div>
              }
            >
              <span style={{ cursor: 'pointer' }}>
                {formatStorageReceipt(session.dataset_cid)}
              </span>
            </Tooltip>
          }
        />
        <button
          className="btn-primary"
          style={{ width: '100%', marginTop: 'auto', padding: '10px' }}
        >
          Verify Dataset
        </button>
      </Card>

      <Card title="Model" icon={<Brain size={15} />}>
        <Row
          label="On-Chain Receipt"
          value={
            <Tooltip
              copyValue={session.end_tx_hash}
              content={
                <div style={{ wordBreak: 'break-all', maxWidth: '240px', color: '#94a3b8', lineHeight: '1.4' }}>
                  {session.end_tx_hash}
                </div>
              }
            >
              <span style={{ cursor: 'pointer' }}>
                {formatOnChainReceipt(session.end_tx_hash, session.end_block_number)}
              </span>
            </Tooltip>
          }
        />
        <Row
          label="Off-Chain Receipt"
          value={
            <Tooltip
              copyValue={session.model_cid}
              content={
                <div style={{ wordBreak: 'break-all', maxWidth: '240px', color: '#94a3b8', lineHeight: '1.4' }}>
                  {session.model_cid}
                </div>
              }
            >
              <span style={{ cursor: 'pointer' }}>
                {formatStorageReceipt(session.model_cid)}
              </span>
            </Tooltip>
          }
        />
        <button
          className="btn-primary"
          style={{ width: '100%', marginTop: 'auto', padding: '10px' }}
        >
          Verify Model
        </button>
      </Card>

      <button
        className="btn-primary"
        style={{ width: '100%', marginTop: 'auto' }}
        onClick={onVerify}
        disabled={verifying}
      >
        {verifying ? 'VERIFYING…' : 'VERIFY LINEAGE'}
      </button>
    </>
  );
};

// ─── EPOCH panel ─────────────────────────────────────────────────────────────

const EpochPanel: React.FC<{ epoch: EpochContext }> = ({ epoch }) => {
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

      <Card title="Checkpoint" icon={<Database size={15} />}>
        <Row
          label="On-Chain Receipt"
          value={
            <Tooltip
              copyValue={epoch.tx_hash}
              content={
                <div style={{ wordBreak: 'break-all', maxWidth: '240px', color: '#94a3b8', lineHeight: '1.4' }}>
                  {epoch.tx_hash}
                </div>
              }
            >
              <span style={{ cursor: 'pointer' }}>
                {onChainReceipt}
              </span>
            </Tooltip>
          }
        />
        <Row
          label="Off-Chain Receipt"
          value={
            <Tooltip
              copyValue={epoch.checkpoint_cid}
              content={
                <div style={{ wordBreak: 'break-all', maxWidth: '240px', color: '#94a3b8', lineHeight: '1.4' }}>
                  {epoch.checkpoint_cid}
                </div>
              }
            >
              <span style={{ cursor: 'pointer' }}>
                {storageReceipt}
              </span>
            </Tooltip>
          }
        />
        <button
          className="btn-primary"
          style={{ width: '100%', marginTop: 'auto', padding: '10px' }}
        >
          Verify Checkpoint
        </button>
      </Card>
    </>
  );
};

// ─── STEP panel ───────────────────────────────────────────────────────────────

const StepPanel: React.FC<{
  data: StepNodeData;
  verificationResult: VerificationResult | null;
}> = ({ data, verificationResult }) => {
  const isVerified = verificationResult?.is_valid;
  const verifying = null;

  const storageReceipt = formatStorageReceipt(data.fullData.cid);
  const onChainReceipt = formatOnChainReceipt(data.fullData.tx_hash, data.fullData.block_number);

  return (
    <>
      <h2 style={{ color: 'var(--accent-cyan)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
        STEP #{data.stepId}
      </h2>

      <Card title="On-Chain Receipt" icon={<Shield size={15} />}>
        <Row
          label=""
          value={
            <Tooltip
              copyValue={data.fullData.tx_hash}
              content={
                <div style={{ wordBreak: 'break-all', maxWidth: '240px', color: '#94a3b8', lineHeight: '1.4' }}>
                  {data.fullData.tx_hash}
                </div>
              }
            >
              <span style={{ cursor: 'pointer' }}>
                {onChainReceipt}
              </span>
            </Tooltip>
          }
        />
      </Card>

      <Card title="Off-Chain Receipt" icon={<Database size={15} />}>
        <Row
          label=""
          value={
            <Tooltip
              copyValue={data.fullData.cid}
              content={
                <div style={{ wordBreak: 'break-all', maxWidth: '240px', color: '#94a3b8', lineHeight: '1.4' }}>
                  {data.fullData.cid}
                </div>
              }
            >
              <span style={{ cursor: 'pointer' }}>
                {storageReceipt}
              </span>
            </Tooltip>
          }
        />
      </Card>

      <Card title="Metrics" icon={<Cpu size={15} />}>
        <pre style={{
          fontSize: '10px', 
          maxHeight: '120px',
          overflowY: 'auto',
          overflowX: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}>
          {JSON.stringify(data.fullData.metrics, null, 2)}
        </pre>
      </Card>
    </>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────

const IntegrityPanel: React.FC<IntegrityPanelProps> = ({
  selectionContext,
  selectedNode,
}) => {
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);

  // Resolve context — prefer new prop, fall back to legacy
  const resolved: SelectionContext = selectionContext !== null
    ? selectionContext
    : selectedNode
      ? 'epoch' in selectedNode
        ? { type: 'epoch', data: selectedNode as EpochContext }
        : { type: 'step',  data: selectedNode as StepNodeData }
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
      {resolved.type === 'epoch'   && <EpochPanel epoch={resolved.data} />}
      {resolved.type === 'step'    && (
        <StepPanel
          data={resolved.data}
          verifying={verifying}
          verificationResult={verificationResult}
          onVerify={handleVerify}
        />
      )}
    </div>
  );
};

export default IntegrityPanel;
