import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Background, Controls, Handle, Position,
  MarkerType,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps
} from 'reactflow';
import 'reactflow/dist/style.css';
import { type StepContext, type EpochContext } from '../services/api';
import EpochNode from './EpochNode';
import { Shield } from 'lucide-react';
import { type LineageVerifyResult } from './IntegrityPanel';

// ─── Layout constants ─────────────────────────────────────────────────────────
const EPOCH_W        = 220;
const EPOCH_H        = 52;
const STEP_W         = 100;
const STEP_H         = 82;
const NODES_PER_ROW  = 4;
const STEP_GAP_X     = 28;
const STEP_GAP_Y     = 32;
const STAGGER_X      = (STEP_W + STEP_GAP_X) / 2;
const GROUP_PAD_X    = 20;
const GROUP_PAD_TOP  = 16;
const GROUP_PAD_BOT  = 20;
const TIMELINE_W     = 160;
const TIMELINE_TOP   = 40;

// ─── Arrow markers ────────────────────────────────────────────────────────────
const ARROW_CYAN  = { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#00f2ff' };
const ARROW_BLUE  = { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#38bdf8' };
const ARROW_DASH  = { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#00f2ff' };

// ─── Step node ────────────────────────────────────────────────────────────────
export interface StepNodeData {
  stepId: number;
  fullData: StepContext;
  isFirstInSeq: boolean;
  isLastInSeq: boolean;
  isRowEnd: boolean;
  isOddRow: boolean;
  posInRow: number;
  /** True when lineage verification returned "OK" for this step */
  isSecured: boolean;
}

const StepNode: React.FC<{ data: StepNodeData; selected: boolean }> = ({ data, selected }) => {
  const { isFirstInSeq, isLastInSeq, isRowEnd, isOddRow, posInRow, isSecured } = data;

  return (
    <div className={`custom-node ${selected ? 'selected-node' : ''}`}
      style={{ width: STEP_W, cursor: 'pointer' }}>
      {/* Target: Receive from previous step */}
      <Handle
        id={isOddRow ? "right" : "left"}
        type="target"
        position={isOddRow ? Position.Right : Position.Left}
        style={{
          visibility: (isFirstInSeq || posInRow === 0) ? 'hidden' : 'visible',
          background: '#38bdf8',
        }}
      />

      {/* Source: Move to next step */}
      {!isRowEnd && (
        <Handle
          id={isOddRow ? "left" : "right"}
          type="source"
          position={isOddRow ? Position.Left : Position.Right}
          style={{ background: '#38bdf8' }}
        />
      )}

      {/* Row Wrap: Source (Bottom) */}
      {isRowEnd && !isLastInSeq && (
        <Handle id="bottom" type="source" position={Position.Bottom}
          style={{ background: '#38bdf8' }} />
      )}

      {/* Row Wrap: Target (Top) */}
      {!isFirstInSeq && posInRow === 0 && (
        <Handle id="top" type="target" position={Position.Top}
          style={{ background: '#38bdf8' }} />
      )}

      <div className="node-header">STEP #{data?.stepId ?? '?'}</div>
      <div className="node-body">
        {isSecured && (
          <div style={{ fontSize: '10px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Shield size={9} /> SECURED
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Group backdrop ───────────────────────────────────────────────────────────
interface EpochGroupData { epoch: number; label: string }

const EpochGroupNode = ({ data }: NodeProps<EpochGroupData>) => (
  <div style={{
    width: '100%', height: '100%',
    background: 'rgba(0,242,255,0.025)',
    border: '1.5px dashed rgba(0,242,255,0.18)',
    borderRadius: '8px', pointerEvents: 'none', position: 'relative',
  }}>
    <div style={{
      position: 'absolute', top: -20, left: 12,
      fontSize: '10px', color: 'rgba(0,242,255,0.4)',
      fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px',
      fontFamily: 'var(--font-mono)',
    }}>{data.label}</div>
  </div>
);

// ─── Timeline node ────────────────────────────────────────────────────────────
interface TimelineNodeData {
  totalHeight: number;
  ticks: { y: number; label: string; isActive: boolean }[];
}

const TimelineNode = ({ data }: NodeProps<TimelineNodeData>) => (
  <div style={{ width: TIMELINE_W, height: data.totalHeight, pointerEvents: 'none', position: 'relative' }}>
    <div style={{
      position: 'absolute', right: 0, top: 0, bottom: 0, width: 2,
      background: 'linear-gradient(to bottom, transparent, rgba(0,242,255,0.5) 6%, rgba(0,242,255,0.5) 94%, transparent)',
    }} />
    {data.ticks.map((t, i) => (
      <div key={i} style={{
        position: 'absolute', top: t.y, right: 0,
        display: 'flex', flexDirection: 'row-reverse', alignItems: 'center',
      }}>
        <div style={{
          width: 10, height: 10, flexShrink: 0,
          background: t.isActive ? '#00f2ff' : '#0d2236',
          border: `2px solid ${t.isActive ? '#00f2ff' : 'rgba(0,242,255,0.4)'}`,
          transform: 'rotate(45deg)', marginRight: -4, zIndex: 2,
        }} />
        <div style={{ width: 14, height: 2, flexShrink: 0, background: t.isActive ? '#00f2ff' : 'rgba(0,242,255,0.3)' }} />
        <span style={{
          fontSize: '12px', fontFamily: 'var(--font-mono)',
          fontWeight: t.isActive ? 700 : 400,
          color: t.isActive ? '#00f2ff' : '#64748b',
          whiteSpace: 'nowrap', paddingRight: 10, letterSpacing: '0.4px',
        }}>{t.label}</span>
      </div>
    ))}
  </div>
);

// ─── Layout helpers ───────────────────────────────────────────────────────────

function staggeredPos(j: number, childCount: number, groupWidth: number) {
  const cols = Math.min(childCount, NODES_PER_ROW);
  const row = Math.floor(j / cols);
  const posInRow = j % cols;
  const isOddRow = row % 2 === 1;
  const physCol = isOddRow ? (cols - 1 - posInRow) : posInRow;
  const rowW = cols * STEP_W + (cols - 1) * STEP_GAP_X;
  const startX = (groupWidth - (rowW + STAGGER_X)) / 2 + GROUP_PAD_X;
  const columnOffset = (physCol % 2 === 1) ? (STEP_H / 2) : 0;

  return {
    x: startX + physCol * (STEP_W + STEP_GAP_X),
    y: GROUP_PAD_TOP + row * (STEP_H + STEP_GAP_Y) + columnOffset,
    row,
    isOddRow,
    isRowEnd: posInRow === cols - 1 || j === childCount - 1,
    isFirstInSeq: j === 0,
    isLastInSeq: j === childCount - 1,
    posInRow,
  };
}

function computeGroupSize(childCount: number) {
  const cols   = Math.min(childCount, NODES_PER_ROW);
  const rows   = Math.ceil(childCount / NODES_PER_ROW);
  const rowW   = cols * STEP_W + (cols - 1) * STEP_GAP_X + STAGGER_X;
  const w      = GROUP_PAD_X * 2 + rowW;
  const baseH  = GROUP_PAD_TOP + (rows * STEP_H) + ((rows - 1) * STEP_GAP_Y);
  const staggerComp = cols > 1 ? (STEP_H / 2) : 0;
  const h = baseH + staggerComp + GROUP_PAD_BOT;
  return { width: Math.max(w, EPOCH_W + GROUP_PAD_X * 2), height: h };
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ─── Types ────────────────────────────────────────────────────────────────────
export interface LineageMapProps {
  steps:               StepContext[];
  epochs:              EpochContext[];
  selectedNode:        StepNodeData | EpochContext | null;
  onNodeClick:         (data: StepNodeData | EpochContext | null) => void;
  /**
   * Latest lineage verify result from IntegrityPanel.
   * stepsValidities drives the SECURED badge on each StepNode.
   */
  lineageVerifyResult?: LineageVerifyResult | null;
}

const nodeTypes = {
  epoch: EpochNode, step: StepNode,
  epochGroup: EpochGroupNode, timeline: TimelineNode,
};

// ─── Component ────────────────────────────────────────────────────────────────
const LineageMap: React.FC<LineageMapProps> = ({
  steps, epochs, selectedNode, onNodeClick, lineageVerifyResult,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [expandedEpochs, setExpandedEpochs] = useState<Set<number>>(new Set());
  const lastKeyRef = useRef('');

  const toggleEpoch = useCallback((epoch: number) => {
    setExpandedEpochs(prev => {
      const next = new Set(prev);
      next.has(epoch) ? next.delete(epoch) : next.add(epoch);
      return next;
    });
  }, []);

  // Build a quick lookup: step_id → true when lineage says "OK"
  const securedSteps = React.useMemo<Set<number>>(() => {
    if (!lineageVerifyResult?.stepsValidities) return new Set();
    const s = new Set<number>();
    Object.entries(lineageVerifyResult.stepsValidities).forEach(([stepId, status]) => {
      if (status === 'verified') s.add(Number(stepId));
    });
    return s;
  }, [lineageVerifyResult]);

  useEffect(() => {
    const stepsByEpoch: Record<number, StepContext[]> = {};
    epochs.forEach((ep, i) => {
      const lo = i === 0 ? 0 : epochs[i - 1].step_id + 1;
      stepsByEpoch[ep.epoch] = steps.filter(p => p.step_id >= lo && p.step_id <= ep.step_id);
      stepsByEpoch[ep.epoch].forEach((p) => p.epoch_id = ep.epoch);
    });

    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    // ══════════════════════════════════════════════════
    // PLAIN MODE
    // ══════════════════════════════════════════════════
    if (!epochs.length) {
      const ROW_W = NODES_PER_ROW * STEP_W + (NODES_PER_ROW - 1) * STEP_GAP_X;
      steps.forEach((p, j) => {
        const sp = staggeredPos(j, steps.length, ROW_W + GROUP_PAD_X * 2);
        rfNodes.push({
          id: `step-${p.step_id}`, type: 'step',
          position: { x: sp.x, y: sp.y },
          selected: selectedNode !== null && !('epoch' in selectedNode)
            && (selectedNode as StepNodeData).stepId === p.step_id,
          data: { stepId: p.step_id, fullData: p, isSecured: securedSteps.has(p.step_id) },
        });
        if (j === 0) return;
        const prev   = steps[j - 1];
        const prevSp = staggeredPos(j - 1, steps.length, ROW_W + GROUP_PAD_X * 2);
        buildStepEdge(rfEdges, prev, p, prevSp, sp);
      });

      const key = JSON.stringify(rfNodes.map(n => n.id));
      if (key !== lastKeyRef.current) { lastKeyRef.current = key; setNodes([...rfNodes]); }
      else setNodes(cur => rfNodes.map(n => { const e = cur.find(c => c.id === n.id); return e ? { ...n, position: e.position } : n; }));
      setEdges([...rfEdges]);
      return;
    }

    // ══════════════════════════════════════════════════
    // EPOCH MODE
    // ══════════════════════════════════════════════════
    const EPOCH_COL_CX  = TIMELINE_W + 8 + 40 + EPOCH_W / 2;
    const GROUP_LEFT_X  = EPOCH_COL_CX + EPOCH_W / 2 + 36;
    const EPOCH_SPACING = 60;

    let cursorY = TIMELINE_TOP + 20;
    const epochCentreY: Record<number, number> = {};

    epochs.forEach(ep => {
      const isExpanded = expandedEpochs.has(ep.epoch);
      const children   = stepsByEpoch[ep.epoch] ?? [];
      const groupSize  = isExpanded ? computeGroupSize(children.length) : { height: 0 };
      const slotH      = isExpanded ? Math.max(groupSize.height, EPOCH_H) : EPOCH_H;
      epochCentreY[ep.epoch] = cursorY + slotH / 2;
      cursorY += slotH + EPOCH_SPACING;
    });

    const totalH = cursorY + 20;

    epochs.forEach((ep, i) => {
      const isExpanded = expandedEpochs.has(ep.epoch);
      const children   = stepsByEpoch[ep.epoch] ?? [];
      const cy         = epochCentreY[ep.epoch];
      const isEpochSel = selectedNode !== null && (
        ('epoch' in selectedNode && (selectedNode as EpochContext).epoch === ep.epoch) ||
        ('fullData' in selectedNode && (selectedNode as StepNodeData).fullData.epoch_id && (selectedNode as StepNodeData).fullData.epoch_id === ep.epoch)
      );

      rfNodes.push({
        id: `epoch-${ep.epoch}`, type: 'epoch',
        position: { x: EPOCH_COL_CX - EPOCH_W / 2, y: cy - EPOCH_H / 2 },
        selected: isEpochSel,
        data: {
          epoch: ep.epoch, fullData: ep,
          isExpanded, childCount: children.length,
          onToggleExpand: toggleEpoch, onNodeClick: () => onNodeClick(ep),
          isFirstInSeq: i === 0,
          isLastInSeq: i === epochs.length - 1,
        },
      });

      if (i > 0) {
        rfEdges.push({
          id: `ee-${epochs[i-1].epoch}-${ep.epoch}`,
          source: `epoch-${epochs[i-1].epoch}`, sourceHandle: 'bottom',
          target: `epoch-${ep.epoch}`,          targetHandle: 'top',
          animated: true, markerEnd: ARROW_CYAN,
          style: { stroke: '#00f2ff', strokeWidth: 2 },
          type: 'smoothstep',
        });
      }

      if (!isExpanded) return;

      const sortedChildren = [...children].sort((a, b) => a.step_id - b.step_id);
      const { width: gW, height: gH } = computeGroupSize(sortedChildren.length);
      const groupY = cy - EPOCH_H / 2;
      const groupX = GROUP_LEFT_X;

      rfNodes.push({
        id: `epoch-group-${ep.epoch}`, type: 'epochGroup',
        position: { x: groupX, y: groupY },
        style: { width: gW, height: gH },
        data: { epoch: ep.epoch, label: `Epoch ${ep.epoch} steps` },
        selectable: false, draggable: false,
      });

      rfEdges.push({
        id: `es-${ep.epoch}-${sortedChildren[0].step_id}`,
        source: `epoch-${ep.epoch}`, sourceHandle: 'right',
        target: `step-${sortedChildren[0].step_id}`, targetHandle: 'left',
        markerEnd: ARROW_DASH,
        style: { stroke: '#00f2ff', strokeWidth: 1.5, strokeDasharray: '5 4' },
      });

      sortedChildren.forEach((p, j) => {
        const sp        = staggeredPos(j, sortedChildren.length, gW);
        const isStepSel = selectedNode !== null && !('epoch' in selectedNode)
          && (selectedNode as StepNodeData).stepId === p.step_id;

        rfNodes.push({
          id: `step-${p.step_id}`, type: 'step',
          position: { x: groupX + sp.x, y: groupY + sp.y },
          selected: isStepSel,
          data: {
            stepId: p.step_id, fullData: p,
            isFirstInSeq: sp.isFirstInSeq,
            isLastInSeq:  sp.isLastInSeq,
            isRowEnd:     sp.isRowEnd,
            isOddRow:     sp.isOddRow,
            posInRow:     sp.posInRow,
            // ← driven by lineageVerifyResult from IntegrityPanel
            isSecured:    securedSteps.has(p.step_id),
          },
        });

        if (j === 0) return;
        const prev   = sortedChildren[j - 1];
        const prevSp = staggeredPos(j - 1, sortedChildren.length, gW);
        buildStepEdge(rfEdges, prev, p, prevSp, sp);
      });
    });

    // Timeline
    const ticks = epochs.map(ep => ({
      y: epochCentreY[ep.epoch] - TIMELINE_TOP,
      label: fmt(ep.timestamp),
      isActive: selectedNode !== null && (
        ('epoch' in selectedNode && selectedNode.epoch === ep.epoch) ||
        ('fullData' in selectedNode && (selectedNode as StepNodeData).fullData.epoch_id && (selectedNode as StepNodeData).fullData.epoch_id === ep.epoch)
      ),
    }));

    rfNodes.push({
      id: 'timeline', type: 'timeline',
      position: { x: 8, y: TIMELINE_TOP },
      data: { totalHeight: totalH, ticks },
      selectable: false, draggable: false,
      style: { width: TIMELINE_W },
    });

    const currentKey = JSON.stringify({
      ids:      rfNodes.map(n => n.id),
      expanded: Array.from(expandedEpochs),
      session:  steps.length > 0 ? steps[0].session_id : 'none',
    });
    if (currentKey !== lastKeyRef.current) {
      lastKeyRef.current = currentKey;
      setNodes([...rfNodes]);
    } else {
      setNodes(cur => rfNodes.map(n => {
        const e = cur.find(c => c.id === n.id);
        return (e && n.selectable !== false) ? { ...n, position: e.position } : n;
      }));
    }
    setEdges([...rfEdges]);

  }, [steps, epochs, expandedEpochs, selectedNode, securedSteps, setNodes, setEdges, onNodeClick, toggleEpoch]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => { if (node.type === 'step') onNodeClick(node.data); }}
        onPaneClick={() => onNodeClick(null)}
        fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.1}
      >
        <Background color="#1e293b" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
};

// ─── Edge builder ─────────────────────────────────────────────────────────────
function buildStepEdge(
  rfEdges: Edge[],
  prev: StepContext,
  cur:  StepContext,
  prevSp: ReturnType<typeof staggeredPos>,
  curSp:  ReturnType<typeof staggeredPos>,
) {
  const id = `ss-${prev.step_id}-${cur.step_id}`;

  if (curSp.row === prevSp.row) {
    rfEdges.push({
      id,
      source: `step-${prev.step_id}`,
      sourceHandle: prevSp.isOddRow ? 'left'  : 'right',
      target: `step-${cur.step_id}`,
      targetHandle: prevSp.isOddRow ? 'right' : 'left',
      animated: true, markerEnd: ARROW_BLUE,
      style: { stroke: '#38bdf8', strokeWidth: 1.5 },
    });
  } else {
    rfEdges.push({
      id,
      source: `step-${prev.step_id}`,  sourceHandle: 'bottom',
      target: `step-${cur.step_id}`,   targetHandle: 'top',
      animated: true, markerEnd: ARROW_BLUE,
      style: { stroke: '#38bdf8', strokeWidth: 1.5 },
      type: 'smoothstep',
    });
  }
}

export type { EpochContext } from '../services/api';
export default LineageMap;
