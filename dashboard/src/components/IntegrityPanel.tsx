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

interface DatasetVerifyResult {
  is_valid: boolean;
  details: {
    anchor_merkle_root: string;
    calculated_merkle_root: string;
    dataset_cid: string;
  };
}

interface ModelVerifyResult {
  is_valid: boolean;
  details: {
    target_model_hash: string;
    calculated_model_hash: string;
    model_cid: string;
  };
}

interface LineageVerifyResult {
  modelValidation: string;
  stepsValidation: Map<number, string>;
}

interface CheckpointVerifyResult {
  is_valid: boolean;
  details: {
    target_checkpoint_hash: string;
    calculated_checkpoint_hash: string;
    checkpoint_cid: string;
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

const Card: React.FC<{ title: React.ReactNode; icon: React.ReactNode; children: React.ReactNode }> = ({
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
}> = ({ session }) => {
  const datasetLabel = session.dataset_name
    ? `${session.dataset_name}${session.dataset_version ? ` ${session.dataset_version}` : ''}`
    : 'N/A';

  const [verifyingDataset, setVerifyingDataset] = useState<boolean>(false);
  const [verifyingModel, setVerifyingModel] = useState<boolean>(false);
  const [verifyingLineage, setVerifyingLineage] = useState<boolean>(false);
  const [datasetVerifyResult, setDatasetVerifyResult] = useState<DatasetVerifyResult | null>(null);
  const [modelVerifyResult, setModelVerifyResult] = useState<ModelVerifyResult | null>(null);
  const [lineageVerifyResult, setLineageVerifyResult] = useState<LineageVerifyResult | null>(null);

  const handleVerifyDataset = async () => {
    try {
      setVerifyingDataset(true);
      setDatasetVerifyResult(null);
      const result = await verifyDataset(session.session_id);
      setDatasetVerifyResult(result);
    } finally {
      setVerifyingDataset(false);
    }
  };

  const handleVerifyModel = async () => {
    try {
      setVerifyingModel(true);
      setModelVerifyResult(null);
      const result = await verifyModel(session.session_id);
      setModelVerifyResult(result);
    } finally {
      setVerifyingModel(false);
    }
  };

  const handleVerifyLineage = async () => {
    try {
      setVerifyingLineage(true);
      setLineageVerifyResult(null);
      const result = await verifyLineage(session.session_id);
      setLineageVerifyResult(result);
    } finally {
      setVerifyingLineage(false);
    }
  };

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

      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <span>Dataset</span>
            {datasetVerifyResult && (
              <div style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: datasetVerifyResult.is_valid ? 'var(--success)' : 'var(--danger)'
              }}>
                {datasetVerifyResult.is_valid ? (
                    <>
                      <Shield size={14} />
                      <span style={{ fontSize: '0.7rem' }}>Verified</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={14} />
                      <span style={{ fontSize: '0.7rem' }}>Invalid</span>
                    </>
                  ) }
              </div>
            )}
          </div>
        }
        icon={<Database size={15} />}
      >
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
          onClick={handleVerifyDataset}
          disabled={verifyingDataset}
        >
          {verifyingDataset ? 'Verifying…' : 'Verify Dataset'}
        </button>
      </Card>

      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <span>Model</span>
            {modelVerifyResult && (
              <div style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: modelVerifyResult.is_valid ? 'var(--success)' : 'var(--danger)'
              }}>
                {modelVerifyResult.is_valid ? (
                    <>
                      <Shield size={14} />
                      <span style={{ fontSize: '0.7rem' }}>Verified</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={14} />
                      <span style={{ fontSize: '0.7rem' }}>Invalid</span>
                    </>
                  ) }
              </div>
            )}
          </div>
        }
        icon={<Brain size={15} />}
      >
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
          onClick={handleVerifyModel}
          disabled={verifyingModel}
        >
          {verifyingModel ? 'Verifying…' : 'Verify Model'}
        </button>
      </Card>

      <button
        className="btn-primary"
        style={{ width: '100%', marginTop: 'auto' }}
        onClick={handleVerifyLineage}
        disabled={verifyingLineage}
      >
        {verifyingLineage ? 'Verifying…' : 'Verify Lineage'}
      </button>
    </>
  );
};

// ─── EPOCH panel ─────────────────────────────────────────────────────────────

const EpochPanel: React.FC<{ epoch: EpochContext }> = ({ epoch }) => {
  const storageReceipt = formatStorageReceipt(epoch.checkpoint_cid);
  const onChainReceipt = formatOnChainReceipt(epoch.tx_hash, epoch.block_number);

  const [verifyingCheckpoint, setVerifyingCheckpoint] = useState<boolean>(false);
  const [checkpointVerifyResult, setCheckpointVerifyResult] = useState<CheckpointVerifyResult | null>(null);

  const handleVerifyCheckpoint = async () => {
    try {
      setVerifyingCheckpoint(true);
      setCheckpointVerifyResult(null);
      const result = await verifyCheckpoint(epoch.session_id, epoch.epoch);
      setCheckpointVerifyResult(result);
    } finally {
      setVerifyingCheckpoint(false);
    }
  };

  return (
    <>
      <h2 style={{ color: 'var(--accent-cyan)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
        EPOCH {epoch.epoch}
      </h2>

      <Card title='' icon={null}>
        <Row label="Session" value={epoch.session_id} />
        <Row label="Ending Step" value={`#${epoch.step_id}`} />
      </Card>

      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <span>Checkpoint</span>
            {checkpointVerifyResult && (
              <div style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: checkpointVerifyResult.is_valid ? 'var(--success)' : 'var(--danger)'
              }}>
                {checkpointVerifyResult.is_valid ? (
                    <>
                      <Shield size={14} />
                      <span style={{ fontSize: '0.7rem' }}>Verified</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={14} />
                      <span style={{ fontSize: '0.7rem' }}>Invalid</span>
                    </>
                  ) }
              </div>
            )}
          </div>
        }
        icon={<Database size={15} />}
      >
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
          onClick={handleVerifyCheckpoint}
          disabled={verifyingCheckpoint}
        >
          {verifyingCheckpoint ? 'Verifying…' : 'Verify Checkpoint'}
        </button>
      </Card>
    </>
  );
};

// ─── STEP panel ───────────────────────────────────────────────────────────────

const StepPanel: React.FC<{
  data: StepNodeData;
}> = ({ data }) => {
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
  // Resolve context — prefer new prop, fall back to legacy
  const resolved: SelectionContext = selectionContext !== null
    ? selectionContext
    : selectedNode
      ? 'epoch' in selectedNode
        ? { type: 'epoch', data: selectedNode as EpochContext }
        : { type: 'step',  data: selectedNode as StepNodeData }
      : null;

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
        <StepPanel data={resolved.data} />
      )}
    </div>
  );
};

export default IntegrityPanel;
