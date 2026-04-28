import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Background, Controls, Handle, Position,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps
} from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import { type AuditPacket, type EpochSummary } from '../services/api';
import EpochNode from './EpochNode';
import { Shield } from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────
const EPOCH_W       = 220;
const EPOCH_H       = 95;
const STEP_W        = 175;
const STEP_H        = 80;
const STEP_GAP_X    = 20;   // horizontal gap between step nodes
const STEP_GAP_Y    = 16;   // vertical gap between step rows
const NODES_PER_ROW = 4;
const GROUP_PAD     = 24;   // padding inside group container
const EPOCH_TO_STEP_Y = 40; // gap between epoch header bottom and first step row
const TIMELINE_X    = 60;   // x position of the vertical timeline bar

// ─── Step node ───────────────────────────────────────────────────────────────
interface StepNodeData {
  stepId: number;
  hash?: string;
  loss?: number;
  fullData: AuditPacket;
}

const StepNode: React.FC<{ data: StepNodeData; selected: boolean }> = ({ data, selected }) => {
  const displayHash = data?.hash ? `${data.hash.substring(0, 10)}…` : 'N/A';
  return (
    <div className={`custom-node valid ${selected ? 'selected-node' : ''}`}
      style={{ width: STEP_W, cursor: 'pointer' }}>
      {/* Left/Right handles for horizontal step→step flow within same row */}
      <Handle type="target" position={Position.Left} id="left" style={{ background: '#334155' }} />
      <Handle type="source" position={Position.Right} id="right" style={{ background: '#334155' }} />
      {/* Top/Bottom handles for row-to-row connections */}
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ background: '#334155', left: '50%' }} />
      <Handle type="target" position={Position.Top} id="top" style={{ background: '#334155', left: '50%' }} />
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
    </div>
  );
};

// ─── Group container node (purely visual — NOT using parentNode) ──────────────
// We avoid ReactFlow's parentNode/extent system because it conflicts with
// dagre-computed positions: the group gets moved by dagre but child absolute
// coords are re-interpreted relative to the new group origin, causing overflow.
// Instead, the group is just a visual backdrop drawn at an absolute position.
interface EpochGroupData {
  epoch: number;
  label: string;
}

const EpochGroupNode = ({ data }: NodeProps<EpochGroupData>) => (
  <div style={{
    width: '100%', height: '100%',
    background: 'rgba(0, 242, 255, 0.03)',
    border: '1.5px dashed rgba(0, 242, 255, 0.15)',
    borderRadius: '8px',
    pointerEvents: 'none',
    position: 'relative',
  }}>
    <div style={{
      position: 'absolute', top: -20, left: 12,
      fontSize: '9px', color: 'rgba(0, 242, 255, 0.4)',
      fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px',
      fontFamily: 'var(--font-mono)',
    }}>
      {data.label}
    </div>
  </div>
);

// ─── Timeline SVG overlay (rendered as a React Flow node) ────────────────────
interface TimelineNodeData {
  totalHeight: number;
  ticks: { y: number; label: string; isActive: boolean }[];
}

const TIMELINE_W = 160; // wider to fit larger timestamp text

const TimelineNode = ({ data }: NodeProps<TimelineNodeData>) => (
  <div style={{ width: TIMELINE_W, height: data.totalHeight, pointerEvents: 'none', position: 'relative' }}>
    {/* Vertical bar — sits at x=TIMELINE_W-2 (right edge) so ticks point right */}
    <div style={{
      position: 'absolute', right: 0, top: 0, bottom: 0,
      width: 2,
      background: 'linear-gradient(to bottom, transparent, rgba(0,242,255,0.5) 8%, rgba(0,242,255,0.5) 92%, transparent)',
    }} />
    {data.ticks.map((t, i) => (
      <div key={i} style={{ position: 'absolute', top: t.y - 10, right: 0, display: 'flex', flexDirection: 'row-reverse', alignItems: 'center', gap: 0 }}>
        {/* Diamond dot on bar */}
        <div style={{
          width: 10, height: 10, flexShrink: 0,
          background: t.isActive ? '#00f2ff' : '#0f2233',
          border: `2px solid ${t.isActive ? '#00f2ff' : 'rgba(0,242,255,0.35)'}`,
          transform: 'rotate(45deg)',
          marginRight: -4,
        }} />
        {/* Tick mark */}
        <div style={{
          width: 16, height: 1.5, flexShrink: 0,
          background: t.isActive ? '#00f2ff' : 'rgba(0,242,255,0.3)',
        }} />
        {/* Timestamp label — right-aligned, larger font */}
        <span style={{
          fontSize: '12px',
          fontFamily: 'var(--font-mono)',
          fontWeight: t.isActive ? 700 : 400,
          color: t.isActive ? '#00f2ff' : '#64748b',
          whiteSpace: 'nowrap',
          paddingRight: 8,
          letterSpacing: '0.5px',
        }}>{t.label}</span>
      </div>
    ))}
  </div>
);

// ─── Layout helpers ───────────────────────────────────────────────────────────

/** Compute the pixel size of an expanded epoch group */
function computeGroupSize(childCount: number) {
  const cols     = Math.min(childCount, NODES_PER_ROW);
  const rows     = Math.ceil(childCount / NODES_PER_ROW);
  const width    = GROUP_PAD * 2 + cols * STEP_W + (cols - 1) * STEP_GAP_X;
  const height   = GROUP_PAD + EPOCH_H + EPOCH_TO_STEP_Y + rows * STEP_H + (rows - 1) * STEP_GAP_Y + GROUP_PAD;
  return { width: Math.max(width, EPOCH_W + GROUP_PAD * 2), height };
}

/** x/y of each step node relative to the group's top-left corner */
function stepLocalPos(j: number, childCount: number, groupWidth: number) {
  const cols  = Math.min(childCount, NODES_PER_ROW);
  const col   = j % NODES_PER_ROW;
  const row   = Math.floor(j / NODES_PER_ROW);
  const totalStepWidth = cols * STEP_W + (cols - 1) * STEP_GAP_X;
  const startX = (groupWidth - totalStepWidth) / 2;
  return {
    x: startX + col * (STEP_W + STEP_GAP_X),
    y: GROUP_PAD + EPOCH_H + EPOCH_TO_STEP_Y + row * (STEP_H + STEP_GAP_Y),
  };
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ─── Types ────────────────────────────────────────────────────────────────────
interface LineageMapProps {
  packets:        AuditPacket[];
  epochSummaries: EpochSummary[];
  selectedPacket: AuditPacket | EpochSummary | null;
  onNodeClick:    (data: AuditPacket | EpochSummary | null) => void;
}

const nodeTypes = { epoch: EpochNode, step: StepNode, epochGroup: EpochGroupNode, timeline: TimelineNode };

// ─── Main component ───────────────────────────────────────────────────────────
const LineageMap: React.FC<LineageMapProps> = ({
  packets, epochSummaries, selectedPacket, onNodeClick,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [expandedEpochs, setExpandedEpochs] = useState<Set<number>>(new Set());
  const lastStructureRef = useRef<string>('');

  const toggleEpoch = useCallback((epoch: number) => {
    setExpandedEpochs(prev => {
      const next = new Set(prev);
      next.has(epoch) ? next.delete(epoch) : next.add(epoch);
      return next;
    });
  }, []);

  useEffect(() => {
    const stepPackets = packets.filter(p => !('epoch' in p));
    const sortedEpochs = [...epochSummaries].sort((a, b) => a.epoch - b.epoch);

    // Group steps by epoch
    const stepsByEpoch: Record<number, AuditPacket[]> = {};
    sortedEpochs.forEach((ep, i) => {
      const lo = i === 0 ? 0 : sortedEpochs[i - 1].step_id + 1;
      stepsByEpoch[ep.epoch] = stepPackets.filter(p => p.step_id >= lo && p.step_id <= ep.step_id);
    });

    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    // ══════════════════════════════════════════════════════════════════
    // PLAIN MODE — no epoch data yet, simple horizontal step chain
    // ══════════════════════════════════════════════════════════════════
    if (!epochSummaries.length) {
      const sorted = [...stepPackets].sort((a, b) => a.step_id - b.step_id);
      sorted.forEach(p => {
        rfNodes.push({
          id: `step-${p.step_id}`, type: 'step',
          position: { x: 0, y: 0 },
          selected: selectedPacket !== null && !('epoch' in selectedPacket)
            && (selectedPacket as AuditPacket).packet_hash === p.packet_hash,
          data: { stepId: p.step_id, hash: p.packet_hash, loss: p.runtime_data?.metrics?.loss, fullData: p },
        });
      });
      for (let i = 0; i < sorted.length - 1; i++) {
        rfEdges.push({
          id: `e-${sorted[i].step_id}-${sorted[i+1].step_id}`,
          source: `step-${sorted[i].step_id}`, target: `step-${sorted[i+1].step_id}`,
          animated: true, style: { stroke: '#00f2ff', strokeWidth: 1.5 },
        });
      }

      // Simple dagre layout for plain mode
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 80 });
      g.setDefaultEdgeLabel(() => ({}));
      rfNodes.forEach(n => g.setNode(n.id, { width: STEP_W, height: STEP_H }));
      rfEdges.forEach(e => g.setEdge(e.source, e.target));
      dagre.layout(g);
      rfNodes.forEach(n => {
        const p = g.node(n.id);
        n.position = { x: p.x - STEP_W / 2, y: p.y - STEP_H / 2 };
      });

      const currentKey = JSON.stringify(rfNodes.map(n => n.id));
      if (currentKey !== lastStructureRef.current) {
        lastStructureRef.current = currentKey;
        setNodes([...rfNodes]);
        setEdges([...rfEdges]);
      } else {
        setNodes(cur => rfNodes.map(n => { const e = cur.find(c => c.id === n.id); return e ? { ...n, position: e.position } : n; }));
        setEdges([...rfEdges]);
      }
      return;
    }

    // ══════════════════════════════════════════════════════════════════
    // EPOCH MODE — vertical timeline + expandable groups
    //
    // Layout strategy:
    //   1. For each epoch, compute its "slot height" (collapsed = EPOCH_H,
    //      expanded = group height).
    //   2. Stack epochs top-to-bottom with spacing, recording each epoch's
    //      absolute Y centre.
    //   3. All step nodes get absolute positions computed from the group
    //      top-left — NO parentNode, so ReactFlow never re-interprets coords.
    //   4. Add a timeline node on the left at x=TIMELINE_X.
    // ══════════════════════════════════════════════════════════════════

    const TIMELINE_X    = 8;
    const EPOCH_COL_X   = 220 + TIMELINE_W; // x-centre of epoch nodes (after timeline)
    const EPOCH_SPACING = 50;               // vertical gap between epoch slots

    let cursorY = 60; // top of the first epoch slot
    const epochCentreY: Record<number, number> = {};

    // Pass 1 — compute Y positions
    sortedEpochs.forEach((ep) => {
      const isExpanded = expandedEpochs.has(ep.epoch);
      const children   = stepsByEpoch[ep.epoch] ?? [];
      const slotH      = isExpanded ? computeGroupSize(children.length).height : EPOCH_H;
      epochCentreY[ep.epoch] = cursorY + slotH / 2;
      cursorY += slotH + EPOCH_SPACING;
    });

    const totalTimelineH = cursorY;

    // Pass 2 — build nodes & edges
    sortedEpochs.forEach((ep, i) => {
      const isExpanded = expandedEpochs.has(ep.epoch);
      const children   = sortedEpochs ? stepsByEpoch[ep.epoch] ?? [] : [];
      const cy         = epochCentreY[ep.epoch];
      const isEpochSel = selectedPacket !== null && 'epoch' in selectedPacket && selectedPacket.epoch === ep.epoch;

      if (!isExpanded) {
        // ── Collapsed epoch node — Handle Top (incoming) + Bottom (outgoing) ──
        rfNodes.push({
          id: `epoch-${ep.epoch}`, type: 'epoch',
          position: { x: EPOCH_COL_X - EPOCH_W / 2, y: cy - EPOCH_H / 2 },
          selected: isEpochSel,
          data: {
            epoch: ep.epoch, sessionId: ep.session_id, stepId: ep.step_id,
            metrics: ep.metrics, cid: ep.cid, txHash: ep.tx_hash,
            timestamp: ep.timestamp, isExpanded,
            childCount: children.length,
            onToggleExpand: toggleEpoch,
            onNodeClick: () => onNodeClick(ep),
          },
        });
      } else {
        // ── Expanded group — place group immediately to the right of epoch column ──
        const sortedChildren = [...children].sort((a, b) => a.step_id - b.step_id);
        const { width: gW, height: gH } = computeGroupSize(sortedChildren.length);

        // Group starts at the epoch column right edge + small gap
        const groupX = EPOCH_COL_X + EPOCH_W / 2 + 32;
        const groupY = cy - gH / 2;

        rfNodes.push({
          id: `epoch-group-${ep.epoch}`, type: 'epochGroup',
          position: { x: groupX, y: groupY },
          style: { width: gW, height: gH },
          data: { epoch: ep.epoch, label: `Epoch ${ep.epoch} Lineage` },
          selectable: false, draggable: false,
        });

        // Epoch header — placed at same vertical centre as group, left of group
        rfNodes.push({
          id: `epoch-${ep.epoch}`, type: 'epoch',
          position: { x: EPOCH_COL_X - EPOCH_W / 2, y: cy - EPOCH_H / 2 },
          selected: isEpochSel,
          data: {
            epoch: ep.epoch, sessionId: ep.session_id, stepId: ep.step_id,
            metrics: ep.metrics, cid: ep.cid, txHash: ep.tx_hash,
            timestamp: ep.timestamp, isExpanded,
            childCount: sortedChildren.length,
            onToggleExpand: toggleEpoch,
            onNodeClick: () => onNodeClick(ep),
          },
        });

        // Step nodes inside the group
        const cols = Math.min(sortedChildren.length, NODES_PER_ROW);
        sortedChildren.forEach((p, j) => {
          const local = stepLocalPos(j, sortedChildren.length, gW);
          const isStepSel = selectedPacket !== null && !('epoch' in selectedPacket)
            && (selectedPacket as AuditPacket).packet_hash === p.packet_hash;
          const col = j % NODES_PER_ROW;
          const row = Math.floor(j / NODES_PER_ROW);
          const isLastInRow = col === cols - 1 || j === sortedChildren.length - 1;
          const isFirstInRow = col === 0;

          rfNodes.push({
            id: `step-${p.step_id}`, type: 'step',
            position: { x: groupX + local.x, y: groupY + local.y },
            selected: isStepSel,
            data: { stepId: p.step_id, hash: p.packet_hash, loss: p.runtime_data?.metrics?.loss, fullData: p },
          });

          if (j === 0) {
            // Epoch → first step: horizontal (epoch right → step left)
            rfEdges.push({
              id: `es-${ep.epoch}-${p.step_id}`,
              source: `epoch-${ep.epoch}`, sourceHandle: 'right',
              target: `step-${p.step_id}`,  targetHandle: 'left',
              style: { stroke: '#00f2ff', strokeWidth: 1.5, strokeDasharray: '5 4' },
            });
          } else {
            const prev = sortedChildren[j - 1];
            const prevCol = (j - 1) % NODES_PER_ROW;
            const prevIsLastInRow = prevCol === cols - 1 || j - 1 === sortedChildren.length - 1;

            if (!isFirstInRow) {
              // Same row: horizontal right→left connection
              rfEdges.push({
                id: `ss-${prev.step_id}-${p.step_id}`,
                source: `step-${prev.step_id}`, sourceHandle: 'right',
                target: `step-${p.step_id}`,   targetHandle: 'left',
                animated: true,
                style: { stroke: '#38bdf8', strokeWidth: 1.5 },
              });
            } else {
              // Row wrap: last in prev row → first in new row via bottom→top
              rfEdges.push({
                id: `ss-${prev.step_id}-${p.step_id}`,
                source: `step-${prev.step_id}`, sourceHandle: 'bottom',
                target: `step-${p.step_id}`,   targetHandle: 'top',
                animated: true,
                style: { stroke: '#38bdf8', strokeWidth: 1.5 },
              });
            }
          }
        });
      }

      // ── Epoch → Epoch edge: Bottom of prev → Top of next (straight vertical) ──
      if (i > 0) {
        const prev = sortedEpochs[i - 1];
        rfEdges.push({
          id: `ee-${prev.epoch}-${ep.epoch}`,
          source: `epoch-${prev.epoch}`, sourceHandle: 'bottom',
          target: `epoch-${ep.epoch}`,   targetHandle: 'top',
          animated: true,
          style: { stroke: '#00f2ff', strokeWidth: 2 },
          type: 'smoothstep',
        });
      }
    });

    // ── Timeline node (leftmost column, spans full height) ────────────
    const ticks = sortedEpochs.map(ep => ({
      y: epochCentreY[ep.epoch],
      label: fmt(ep.timestamp),
      isActive: selectedPacket !== null && 'epoch' in selectedPacket && selectedPacket.epoch === ep.epoch,
    }));

    rfNodes.push({
      id: 'timeline', type: 'timeline',
      position: { x: 8, y: 40 },
      data: { totalHeight: totalTimelineH, ticks },
      selectable: false, draggable: false,
      style: { width: TIMELINE_W },
    });

    // ── Commit to ReactFlow ──────────────────────────────────────────
    const currentKey = JSON.stringify({
      ids:      rfNodes.map(n => n.id),
      expanded: Array.from(expandedEpochs),
      session:  stepPackets.length > 0 ? stepPackets[0].session_id : 'none',
    });

    if (currentKey !== lastStructureRef.current) {
      lastStructureRef.current = currentKey;
      setNodes([...rfNodes]);
    } else {
      // Structure unchanged — only update data (selection, metrics)
      setNodes(cur =>
        rfNodes.map(n => {
          const existing = cur.find(c => c.id === n.id);
          // Preserve user-dragged positions for non-locked nodes
          return existing && !n.draggable === false
            ? { ...n, position: existing.position }
            : n;
        })
      );
    }
    setEdges([...rfEdges]);

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
          // epoch clicks handled inside EpochNode via data.onNodeClick
        }}
        onPaneClick={() => onNodeClick(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
      >
        <Background color="#1e293b" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
};

export default LineageMap;