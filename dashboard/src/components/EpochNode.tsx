// src/components/EpochNode.tsx
// Custom React Flow node for epoch-level DAG nodes.
// Shows epoch number, test accuracy, avg loss. 
// Click the chevron to expand/collapse child step nodes.

import React from 'react';
import { Handle, Position } from 'reactflow';
import { ChevronDown, ChevronRight, Shield, TrendingUp } from 'lucide-react';

export interface EpochNodeData {
  epoch: number;
  sessionId: string;
  stepId: number;
  metrics: { test_accuracy?: number; avg_loss?: number; epoch?: number };
  cid: string;
  txHash: string;
  timestamp: string;
  isExpanded: boolean;
  childCount: number;
  onToggleExpand: (epoch: number) => void;
  onNodeClick: (data: EpochNodeData) => void;
}

const EpochNode: React.FC<{ data: EpochNodeData; selected: boolean }> = ({ data, selected }) => {
  const accuracy = data.metrics?.test_accuracy;
  const loss = data.metrics?.avg_loss;

  // Colour-code accuracy band
  const accuracyColor =
    accuracy == null ? 'var(--text-secondary)'
    : accuracy >= 97  ? 'var(--success)'
    : accuracy >= 93  ? 'var(--warning)'
    : 'var(--danger)';

  return (
    <div
      className={`epoch-node ${selected ? 'epoch-node--selected' : ''}`}
      onClick={() => data.onNodeClick(data)}
      style={{
        background: 'var(--bg-secondary)',
        border: `1px solid ${selected ? 'var(--accent-cyan)' : '#1e293b'}`,
        borderLeft: `4px solid ${accuracyColor}`,
        borderRadius: '4px',
        padding: '10px 12px',
        width: '220px',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        cursor: 'pointer',
        boxShadow: selected ? '0 0 16px rgba(0,242,255,0.3)' : '0 4px 12px rgba(0,0,0,0.4)',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Top handle — receives connection from previous epoch */}
      <Handle id="top" type="target" position={Position.Top}
        style={{ background: '#00f2ff', width: 8, height: 8, border: '2px solid #0a0b10' }} />

      {/* Left handle — receives connection from timeline (visual only) */}
      <Handle id="left" type="target" position={Position.Left}
        style={{ background: '#334155', opacity: 0 }} />

      {/* Right handle — sends connection to first step when expanded */}
      <Handle id="right" type="source" position={Position.Right}
        style={{ background: '#00f2ff', width: 8, height: 8, border: '2px solid #0a0b10' }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, fontSize: '12px' }}>
          EPOCH {data.epoch}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); data.onToggleExpand(data.epoch); }}
          style={{
            background: 'none',
            border: '1px solid #1e293b',
            borderRadius: '3px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '1px 4px',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            fontSize: '9px',
          }}
          title={data.isExpanded ? 'Collapse steps' : `Expand ${data.childCount} steps`}
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
            <span style={{ color: accuracyColor, fontWeight: 600 }}>
              {accuracy.toFixed(2)}%
            </span>
          </div>
        )}
        {loss != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#64748b' }}>loss</span>
            <span style={{ color: 'var(--text-primary)' }}>{loss.toFixed(4)}</span>
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

      {/* Bottom handle — sends connection to next epoch */}
      <Handle id="bottom" type="source" position={Position.Bottom}
        style={{ background: '#00f2ff', width: 8, height: 8, border: '2px solid #0a0b10' }} />
    </div>
  );
};

export default EpochNode;