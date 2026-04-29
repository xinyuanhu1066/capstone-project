import React from 'react';
import { Handle, Position } from 'reactflow';
import { ChevronDown, ChevronRight, TrendingUp, Shield } from 'lucide-react';

export interface EpochNodeData {
  epoch: number;
  sessionId: string;
  stepId: number;
  metrics: { test_accuracy?: number; avg_loss?: number; epoch?: number };
  cid: string;
  txHash: string;
  timestamp: string;
  isExpanded: boolean;
  isFirstInSeq: boolean;
  isLastInSeq: boolean;
  childCount: number;
  onToggleExpand: (epoch: number) => void;
  onNodeClick: () => void;
}

const EpochNode: React.FC<{ data: EpochNodeData; selected: boolean }> = ({ data, selected }) => {
  const accuracy = data.metrics?.test_accuracy;
  const loss     = data.metrics?.avg_loss;
  const { isFirstInSeq, isLastInSeq } = data;

  const accuracyColor =
    accuracy == null  ? '#64748b'
    : accuracy >= 97  ? '#10b981'
    : accuracy >= 93  ? '#f59e0b'
    : '#ef4444';

  return (
    <div
      onClick={() => data.onNodeClick()}
      style={{
        background: '#14161e',
        border: `1px solid ${selected ? '#00f2ff' : '#1e293b'}`,
        borderLeft: `4px solid ${accuracyColor}`,
        borderRadius: '4px',
        padding: '10px 12px',
        width: '220px',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        cursor: 'pointer',
        boxShadow: selected ? '0 0 16px rgba(0,242,255,0.3)' : '0 4px 12px rgba(0,0,0,0.5)',
        transition: 'all 0.2s ease',
        position: 'relative',
      }}
    >
      {/* top — receives from previous epoch's bottom */}
      {!isFirstInSeq && (
        <Handle id="top" type="target" position={Position.Top}
          style={{ background: '#00f2ff', width: 8, height: 8, border: '2px solid #0a0b10' }} />
      )}

      {/* bottom — sends to next epoch's top */}
      {!isLastInSeq && (
        <Handle id="bottom" type="source" position={Position.Bottom}
          style={{ background: '#00f2ff', width: 8, height: 8, border: '2px solid #0a0b10' }} />
      )}

      {/* right — sends to first step node when expanded */}
      <Handle id="right" type="source" position={Position.Right}
        style={{ background: '#00f2ff', width: 8, height: 8, border: '2px solid #0a0b10' }} />

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ color: '#00f2ff', fontWeight: 700, fontSize: '12px' }}>
          EPOCH {data.epoch}
        </span>
        <button
          onClick={e => { e.stopPropagation(); data.onToggleExpand(data.epoch); }}
          style={{
            background: 'none', border: '1px solid #1e293b', borderRadius: '3px',
            color: '#94a3b8', cursor: 'pointer', padding: '1px 5px',
            display: 'flex', alignItems: 'center', gap: '3px', fontSize: '9px',
          }}
        >
          {data.isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {data.childCount}
        </button>
      </div>

      {/* Metrics */}
      <div style={{ borderTop: '1px solid #1e293b', paddingTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {accuracy != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <TrendingUp size={9} /> acc
            </span>
            <span style={{ color: accuracyColor, fontWeight: 600 }}>{accuracy.toFixed(2)}%</span>
          </div>
        )}
        {loss != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#64748b' }}>loss</span>
            <span style={{ color: '#e0e6ed' }}>{loss.toFixed(4)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
          <span style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Shield size={9} /> CID
          </span>
          <span style={{ color: '#475569', fontSize: '9px' }}>
            {data.cid ? data.cid.substring(0, 10) + '…' : 'N/A'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default EpochNode;