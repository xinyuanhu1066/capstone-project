import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Background, Controls, Handle, Position,
  useNodesState, useEdgesState,
  type Node, type Edge,
} from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import { type AuditPacket, type EpochSummary } from '../services/api';
import EpochNode from './EpochNode';
import { Shield } from 'lucide-react';

const EPOCH_W = 220, EPOCH_H = 95;
const STEP_W  = 180, STEP_H  = 80;

interface StepNodeData {
  stepId: number;
  hash?: string;
  loss?: number;
  fullData: AuditPacket;
}

// ─── Step node ───────────────────────────────────────────────────────────────
const StepNode: React.FC<{ data: StepNodeData; selected: boolean }> = ({ data, selected }) => {
  const displayHash = data?.hash ? `${data.hash.substring(0, 10)}…` : 'N/A';
  return (
    <div
      className={`custom-node valid ${selected ? 'selected-node' : ''}`}
      style={{ width: STEP_W, cursor: 'pointer' }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#334155' }} />
      <div className="node-header">STEP #{data?.stepId ?? '?'}</div>
      <div className="node-body">
        <div style={{ fontSize: '10px', color: '#94a3b8' }}>Hash: {displayHash}</div>
        {data?.loss != null && (
          <div style={{ fontSize: '10px', color: '#64748b' }}>
            Loss: {Number(data.loss).toFixed(4)}
          </div>
        )}
        <div style={{ fontSize: '10px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Shield size={9} /> SECURED
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#334155' }} />
    </div>
  );
};

// ─── Dagre layout ─────────────────────────────────────────────────────────────
const applyDagreLayout = (
  nodes: Node[],
  edges: Edge[],
  nodeW: number,
  nodeH: number,
  rankdir = 'LR',
): Node[] => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 60, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach(n => g.setNode(n.id, { width: nodeW, height: nodeH }));
  edges.forEach(e => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map(n => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - nodeW / 2, y: pos.y - nodeH / 2 } };
  });
};

interface LineageMapProps {
  packets: AuditPacket[];
  epochSummaries: EpochSummary[];
  selectedPacket: AuditPacket | EpochSummary | null;
  onNodeClick: (data: AuditPacket | EpochSummary) => void;
}

// ─── Node types (stable reference — defined outside component) ────────────────
const nodeTypes = { epoch: EpochNode, step: StepNode };

// ─── Main component ───────────────────────────────────────────────────────────
const LineageMap: React.FC<LineageMapProps> = ({
  packets,
  epochSummaries,
  selectedPacket,
  onNodeClick,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [expandedEpochs, setExpandedEpochs] = useState<Set<number>>(new Set());
  
  // Track structural identity to avoid re-layouts
  const lastStructureRef = useRef<string>('');

  const toggleEpoch = useCallback((epoch: number) => {
    setExpandedEpochs(prev => {
      const next = new Set(prev);
      if (next.has(epoch)) {
        next.delete(epoch);
      } else {
        next.add(epoch);
      }
      return next;
    });
  }, []);

  // Sync internal state when props change
  useEffect(() => {
    // 1. Group packets by epoch
    const stepsByEpoch: Record<number, AuditPacket[]> = {};
    const sortedEpochs = [...epochSummaries].sort((a, b) => a.epoch - b.epoch);
    sortedEpochs.forEach((ep, i) => {
      const lo = i === 0 ? 0 : sortedEpochs[i - 1].step_id + 1;
      stepsByEpoch[ep.epoch] = packets.filter(p => p.step_id >= lo && p.step_id <= ep.step_id);
    });

    // 2. Build graph elements
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    if (!epochSummaries.length) {
      // Fallback: Step chain
      const sorted = [...packets].sort((a, b) => a.step_id - b.step_id);
      sorted.forEach(p => {
        rfNodes.push({
          id: `step-${p.step_id}`,
          type: 'step',
          position: { x: 0, y: 0 },
          selected: selectedPacket !== null && !('epoch' in selectedPacket) && selectedPacket.packet_hash === p.packet_hash,
          data: {
            stepId: p.step_id,
            hash: p.packet_hash,
            loss: p.runtime_data?.metrics?.loss,
            fullData: p,
          },
        });
      });
      sorted.slice(0, -1).forEach((p, i) => {
        rfEdges.push({
          id: `e-${p.step_id}-${sorted[i + 1].step_id}`,
          source: `step-${p.step_id}`,
          target: `step-${sorted[i + 1].step_id}`,
          animated: true,
          style: { stroke: '#00f2ff', strokeWidth: 1.5 },
        });
      });
    } else {
      // Epoch Tiered DAG
      sortedEpochs.forEach((ep, i) => {
        const isExpanded = expandedEpochs.has(ep.epoch);
        const children   = stepsByEpoch[ep.epoch] ?? [];

        rfNodes.push({
          id: `epoch-${ep.epoch}`,
          type: 'epoch',
          position: { x: 0, y: 0 },
          selected: selectedPacket !== null && 'epoch' in selectedPacket && selectedPacket.epoch === ep.epoch,
          data: {
            epoch: ep.epoch,
            sessionId: ep.session_id,
            stepId: ep.step_id,
            metrics: ep.metrics,
            cid: ep.cid,
            txHash: ep.tx_hash,
            timestamp: ep.timestamp,
            isExpanded,
            childCount: children.length,
            onToggleExpand: toggleEpoch,
            onNodeClick: () => onNodeClick(ep),
          },
        });

        if (i > 0) {
          rfEdges.push({
            id: `ee-${sortedEpochs[i - 1].epoch}-${ep.epoch}`,
            source: `epoch-${sortedEpochs[i - 1].epoch}`,
            target: `epoch-${ep.epoch}`,
            animated: true,
            style: { stroke: '#00f2ff', strokeWidth: 2 },
          });
        }

        if (isExpanded) {
          const sortedChildren = [...children].sort((a, b) => a.step_id - b.step_id);
          sortedChildren.forEach((p, j) => {
            const stepNodeId = `step-${p.step_id}`;
            rfNodes.push({
              id: stepNodeId,
              type: 'step',
              position: { x: 0, y: 0 },
              selected: selectedPacket !== null && !('epoch' in selectedPacket) && selectedPacket.packet_hash === p.packet_hash,
              data: {
                stepId: p.step_id,
                hash: p.packet_hash,
                loss: p.runtime_data?.metrics?.loss,
                fullData: p,
              },
            });

            if (j === 0) {
              rfEdges.push({
                id: `es-epoch${ep.epoch}-step${p.step_id}`,
                source: `epoch-${ep.epoch}`,
                target: stepNodeId,
                style: { stroke: '#334155', strokeDasharray: '4 3' },
              });
            } else {
              rfEdges.push({
                id: `ss-${sortedChildren[j - 1].step_id}-${p.step_id}`,
                source: `step-${sortedChildren[j - 1].step_id}`,
                target: stepNodeId,
                animated: true,
                style: { stroke: '#334155', strokeWidth: 1 },
              });
            }
          });
        }
      });
    }

    // 3. Determine if layout is needed
    const currentStructure = JSON.stringify({
      nodes: rfNodes.map(n => n.id),
      expanded: Array.from(expandedEpochs),
      session: packets.length > 0 ? packets[0].session_id : 'none'
    });

    if (currentStructure !== lastStructureRef.current) {
      lastStructureRef.current = currentStructure;
      
      // Perform Layout
      let laidOutNodes = rfNodes;
      if (epochSummaries.length === 0) {
        laidOutNodes = applyDagreLayout(rfNodes, rfEdges, STEP_W, STEP_H);
      } else {
        // Advanced layout for Epoch mode
        const epochOnly = rfNodes.filter(n => n.type === 'epoch');
        const epochEdges = rfEdges.filter(e => e.id.startsWith('ee-'));
        const laidOutEpochs = applyDagreLayout(epochOnly, epochEdges, EPOCH_W, EPOCH_H);
        
        const epochPos: Record<string, { x: number; y: number }> = {};
        laidOutEpochs.forEach(n => { epochPos[n.id] = n.position; });
        
        rfNodes.forEach(n => {
          if (n.type === 'epoch') {
            n.position = epochPos[n.id] || { x: 0, y: 0 };
          } else {
            const parentEdge = rfEdges.find(e => e.target === n.id && e.id.startsWith('es-'));
            if (parentEdge) {
              const epochNum = parseInt(parentEdge.source.replace('epoch-', ''));
              const siblings = (stepsByEpoch[epochNum] || []).sort((a, b) => a.step_id - b.step_id);
              const idx = siblings.findIndex(p => `step-${p.step_id}` === n.id);
              const pPos = epochPos[parentEdge.source] || { x: 0, y: 0 };
              n.position = {
                x: pPos.x + (idx - (siblings.length - 1) / 2) * (STEP_W + 20),
                y: pPos.y + EPOCH_H + 50,
              };
            }
          }
        });
        laidOutNodes = rfNodes;
      }
      
      setNodes(laidOutNodes);
      setEdges(rfEdges);
    } else {
      // Structure is same, just update data (like selection or loss values)
      // but PRESERVE existing positions
      setNodes(currentNodes => 
        rfNodes.map(newNode => {
          const existing = currentNodes.find(n => n.id === newNode.id);
          return existing ? { ...newNode, position: existing.position } : newNode;
        })
      );
      setEdges(rfEdges);
    }
  }, [packets, epochSummaries, expandedEpochs, selectedPacket, setNodes, setEdges, onNodeClick, toggleEpoch]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          if (node.type === 'step') {
            onNodeClick(node.data.fullData as AuditPacket);
          }
        }}
        onPaneClick={() => onNodeClick(null as any)}
        fitView
        fitViewOptions={{ padding: 0.25 }}
      >
        <Background color="#1e293b" gap={20} />
        <Controls />
      </ReactFlow>

      <div style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        fontSize: '10px',
        fontFamily: 'var(--font-mono)',
        color: '#94a3b8',
        background: 'rgba(10,11,16,0.75)',
        padding: '5px 10px',
        borderRadius: '4px',
        border: '1px solid #1e293b',
        pointerEvents: 'none',
      }}>
        {epochSummaries.length > 0
          ? 'Click epoch chevron ▶ to expand step nodes'
          : `${nodes.length} step node${nodes.length !== 1 ? 's' : ''} · no epoch data yet`}
      </div>
    </div>
  );
};

export default LineageMap;
