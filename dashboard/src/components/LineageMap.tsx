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
const NODES_PER_ROW = 4;

interface StepNodeData {
  stepId: number;
  hash?: string;
  loss?: number;
  fullData: AuditPacket;
}

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

const getLayoutedElements = (nodes: Node[], edges: Edge[], rankdir = 'LR') => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 100, ranksep: 140 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    const width = node.width || (node.type === 'epoch' ? EPOCH_W : STEP_W);
    const height = node.height || (node.type === 'epoch' ? EPOCH_H : STEP_H);
    g.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    const width = node.width || (node.type === 'epoch' ? EPOCH_W : STEP_W);
    const height = node.height || (node.type === 'epoch' ? EPOCH_H : STEP_H);
    
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });
};

interface LineageMapProps {
  packets: AuditPacket[];
  epochSummaries: EpochSummary[];
  selectedPacket: AuditPacket | EpochSummary | null;
  onNodeClick: (data: AuditPacket | EpochSummary | null) => void;
}

const nodeTypes = { epoch: EpochNode, step: StepNode };

const LineageMap: React.FC<LineageMapProps> = ({
  packets,
  epochSummaries,
  selectedPacket,
  onNodeClick,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [expandedEpochs, setExpandedEpochs] = useState<Set<number>>(new Set());
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

  useEffect(() => {
    const stepPackets = packets.filter(p => !('epoch' in p));
    const sortedEpochs = [...epochSummaries].sort((a, b) => a.epoch - b.epoch);
    const stepsByEpoch: Record<number, AuditPacket[]> = {};
    
    sortedEpochs.forEach((ep, i) => {
      const lo = i === 0 ? 0 : sortedEpochs[i - 1].step_id + 1;
      stepsByEpoch[ep.epoch] = stepPackets.filter(p => p.step_id >= lo && p.step_id <= ep.step_id);
    });

    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    if (!epochSummaries.length) {
      const sorted = [...stepPackets].sort((a, b) => a.step_id - b.step_id);
      sorted.forEach(p => {
        rfNodes.push({
          id: `step-${p.step_id}`,
          type: 'step',
          position: { x: 0, y: 0 },
          selected: selectedPacket !== null && !('epoch' in selectedPacket) && (selectedPacket as AuditPacket).packet_hash === p.packet_hash,
          data: { stepId: p.step_id, hash: p.packet_hash, loss: p.runtime_data?.metrics?.loss, fullData: p },
        });
      });
      sorted.slice(0, -1).forEach((p, i) => {
        rfEdges.push({
          id: `e-${p.step_id}-${sorted[i+1].step_id}`,
          source: `step-${p.step_id}`,
          target: `step-${sorted[i+1].step_id}`,
          animated: true,
          style: { stroke: '#00f2ff', strokeWidth: 1.5 },
        });
      });
    } else {
      sortedEpochs.forEach((ep, i) => {
        const isExpanded = expandedEpochs.has(ep.epoch);
        const children = stepsByEpoch[ep.epoch] ?? [];
        
        let virtualWidth = EPOCH_W;
        let virtualHeight = EPOCH_H;
        
        if (isExpanded && children.length > 0) {
          const cols = Math.min(children.length, NODES_PER_ROW);
          const rows = Math.ceil(children.length / NODES_PER_ROW);
          virtualWidth = Math.max(EPOCH_W, cols * (STEP_W + 20));
          virtualHeight = EPOCH_H + 60 + rows * (STEP_H + 40);
        }

        rfNodes.push({
          id: `epoch-${ep.epoch}`,
          type: 'epoch',
          position: { x: 0, y: 0 },
          width: virtualWidth,
          height: virtualHeight,
          selected: selectedPacket !== null && 'epoch' in selectedPacket && selectedPacket.epoch === ep.epoch,
          data: {
            epoch: ep.epoch, sessionId: ep.session_id, stepId: ep.step_id,
            metrics: ep.metrics, cid: ep.cid, txHash: ep.tx_hash,
            timestamp: ep.timestamp, isExpanded, childCount: children.length,
            onToggleExpand: toggleEpoch, onNodeClick: () => onNodeClick(ep),
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
          sortedChildren.forEach((p) => {
            rfNodes.push({
              id: `step-${p.step_id}`,
              type: 'step',
              position: { x: 0, y: 0 },
              selected: selectedPacket !== null && !('epoch' in selectedPacket) && (selectedPacket as AuditPacket).packet_hash === p.packet_hash,
              data: { stepId: p.step_id, hash: p.packet_hash, loss: p.runtime_data?.metrics?.loss, fullData: p },
              parentNode: `epoch-${ep.epoch}`,
              extent: 'parent',
              draggable: false,
            });
          });
        }
      });
    }

    const currentStructure = JSON.stringify({
      nodes: rfNodes.map(n => n.id),
      expanded: Array.from(expandedEpochs),
      session: stepPackets.length > 0 ? stepPackets[0].session_id : 'none'
    });

    if (currentStructure !== lastStructureRef.current) {
      lastStructureRef.current = currentStructure;
      
      const containerNodes = rfNodes.filter(n => !n.parentNode);
      const containerEdges = rfEdges.filter(e => !rfNodes.find(n => n.id === e.source && n.parentNode));
      
      const laidOutContainers = getLayoutedElements(containerNodes, containerEdges);
      
      const finalNodes = [...laidOutContainers];
      rfNodes.forEach(n => {
        if (n.parentNode) {
          const parent = laidOutContainers.find(p => p.id === n.parentNode);
          if (parent) {
            const siblings = rfNodes.filter(s => s.parentNode === n.parentNode);
            const idx = siblings.findIndex(s => s.id === n.id);
            
            const cols = Math.min(siblings.length, NODES_PER_ROW);
            const row = Math.floor(idx / NODES_PER_ROW);
            const col = idx % NODES_PER_ROW;
            
            n.position = {
              x: (parent.width! / 2) + (col - (cols - 1) / 2) * (STEP_W + 20) - (STEP_W / 2),
              y: EPOCH_H + 40 + row * (STEP_H + 30),
            };
            finalNodes.push(n);
          }
        }
      });

      setNodes(finalNodes);
      setEdges(rfEdges);
    } else {
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
          if (node.type === 'step') onNodeClick(node.data.fullData);
        }}
        onPaneClick={() => onNodeClick(null)}
        fitView
        fitViewOptions={{ padding: 0.25 }}
      >
        <Background color="#1e293b" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
};

export default LineageMap;
