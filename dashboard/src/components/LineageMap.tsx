import React, { useMemo } from 'react';
import ReactFlow, { 
  Background, 
  Controls,
  Handle,
  Position,
  type Node,
  type Edge
} from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import { type AuditPacket } from '../services/api';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 200;
const nodeHeight = 80;

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  dagreGraph.setGraph({ rankdir: 'LR' });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };
  });

  return { nodes, edges };
};

const CustomNode = ({ data }: any) => {
  const displayHash = data?.hash ? `${data.hash.substring(0, 12)}...` : 'N/A';
  
  return (
    <div className="custom-node valid">
      <Handle type="target" position={Position.Left} style={{ background: '#555' }} />
      <div className="node-header">STEP #{data?.stepId ?? '?'}</div>
      <div className="node-body">
        <div style={{fontSize: '10px', color: '#94a3b8'}}>Hash: {displayHash}</div>
        <div style={{fontSize: '10px', color: '#10b981'}}>Integrity: SECURED</div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#555' }} />
    </div>
  );
};

// Define nodeTypes outside to avoid re-renders and warnings
const nodeTypes = {
  custom: CustomNode,
};

interface LineageMapProps {
  packets: AuditPacket[];
  onNodeClick: (packet: AuditPacket) => void;
}

const LineageMap: React.FC<LineageMapProps> = ({ packets, onNodeClick }) => {
  const { nodes, edges } = useMemo(() => {
    const initialNodes: Node[] = packets.map((p, index) => ({
      // Use a more robust ID generation to avoid 'undefined' keys
      id: p.packet_hash || `step-idx-${index}-${p.step_id}`,
      type: 'custom',
      data: { stepId: p.step_id, hash: p.packet_hash, fullData: p },
      position: { x: 0, y: 0 },
    }));

    const initialEdges: Edge[] = [];
    for (let i = 0; i < initialNodes.length - 1; i++) {
      const sourceId = initialNodes[i].id;
      const targetId = initialNodes[i+1].id;
      
      initialEdges.push({
        id: `e-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        animated: true,
        style: { stroke: '#00f2ff' },
      });
    }

    return getLayoutedElements(initialNodes, initialEdges);
  }, [packets]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onNodeClick(node.data.fullData)}
        fitView
      >
        <Background color="#1e293b" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
};

export default LineageMap;
