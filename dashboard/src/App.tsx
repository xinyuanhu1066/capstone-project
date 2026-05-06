import { useState, useEffect, useCallback, useRef } from 'react';
import './styles/theme.css';
import { fetchPackets, fetchSessions, type SessionContext, type StepContext, type EpochContext, type SelectionContext } from './services/api';
import LineageMap from './components/LineageMap';
import { type StepNodeData } from './components/LineageMap';
import IntegrityPanel from './components/IntegrityPanel';
import { type LineageVerifyResult } from './components/IntegrityPanel';
import { Terminal, DatabaseZap, History, Activity } from 'lucide-react';

function App() {
  const [sessions, setSessions] = useState<SessionContext[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepContext[]>([]);
  const [selectedNode, setSelectedNode] = useState<StepNodeData | EpochContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [epochs, setEpochs] = useState<EpochContext[]>([]);
  const [selectionContext, setSelectionContext] = useState<SelectionContext>(null);
  const [selectedSession, setSelectedSession] = useState<SessionContext | null>(null); 
  const [lineageResult, setLineageResult] = useState<LineageVerifyResult | null>(null);
  const lineageResultsRef = useRef<Record<string, LineageVerifyResult>>({});

  // Use a ref to store the current session ID to avoid dependency cycle in loadData
  const selectedSessionIdRef = useRef<string | null>(null);
  const packetsRef = useRef<string>('');

  const loadData = useCallback(async () => {
    try {
      // 1. Load Sessions
      const sessionsData = await fetchSessions();
      setSessions(sessionsData);
      
      // Update our local ref and state if no session is selected
      if (!selectedSessionIdRef.current && sessionsData.length > 0) {
        selectedSessionIdRef.current = sessionsData[0].session_id;
        setSelectedSessionId(sessionsData[0].session_id);
        setSelectedSession(sessionsData[0]);
        setSelectionContext({ type: 'session', data: sessionsData[0] });
      }

      const sessionId = selectedSessionIdRef.current;
      if (sessionId) {
        try {
          const packetsData = await fetchPackets(sessionId);
          const packetsJson = JSON.stringify(packetsData);
          if (packetsJson !== packetsRef.current) {
            packetsRef.current = packetsJson;
            const sortedSteps = [...packetsData.steps].sort((a, b) => a.step_id - b.step_id);
            const sortedEpochs = [...packetsData.epochs].sort((a, b) => a.epoch - b.epoch);
            setSteps(sortedSteps);
            setEpochs(sortedEpochs);
          }
        } catch (err) {
          console.error('[Dashboard Error] Failed to load steps and epochs:', err);
        }
      }
    } catch (error) {
      console.error('[Dashboard Error] Global sync failed:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll for data updates
  useEffect(() => {
    const timer = setTimeout(() => {
      loadData();
    }, 0);
    
    const interval = setInterval(loadData, 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [loadData]);

  const handleSessionSelect = (session: SessionContext) => {
    setSelectedNode(null);
    setLineageResult(lineageResultsRef.current[session.session_id] ?? null);
  
    if (session.session_id === selectedSessionId) {
      setSelectionContext({ type: 'session', data: selectedSession! });
      return;
    }
    
    // Reset refs so the next load definitely triggers a state update
    packetsRef.current = '';
    
    selectedSessionIdRef.current = session.session_id;
    setSelectedSessionId(session.session_id);
    setSelectedSession(session);
    setSelectionContext({ type: 'session', data: session! });
    
    // Trigger immediate load
    loadData();
  };

  const handleNodeClick = (node: StepNodeData | EpochContext | null) => {
    if (node === null) {
      setSelectedNode(null);
      setSelectionContext({ type: 'session', data: selectedSession! });
    } else {
      setSelectedNode(node);
      setSelectionContext(null);
    }
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-cyan)' }}>
            <History size={20} />
            <h2 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Training History</h2>
          </div>
        </div>
        <div className="sidebar-content">
          {sessions.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>
              <p style={{ fontSize: '0.8rem' }}>No sessions found</p>
            </div>
          ) : (
            sessions.map((s) => (
              <div 
                key={s.session_id} 
                className={`activity-item ${selectedSessionId === s.session_id ? 'active' : ''}`}
                onClick={() => handleSessionSelect(s)}
              >
                <div className="activity-id">{s.session_id.split('-').slice(0, 2).join('-')}...</div>
                <div className="activity-time">{formatTime(s.start_time)}</div>
                <div className="activity-meta">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Activity size={12} /> {s.steps} steps
                  </span>
                  <span>{new Date(s.start_time).toLocaleDateString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="lineage-container">
        <header style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          zIndex: 10, 
          padding: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(10, 11, 16, 0.8)',
          width: '100%',
          borderBottom: '1px solid var(--border-color)',
          backdropFilter: 'blur(10px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Terminal color="var(--accent-cyan)" size={28} />
            <div>
              <h1 style={{ fontSize: '1.2rem', letterSpacing: '2px', fontWeight: 900 }}>
                AI <span style={{ color: 'var(--accent-cyan)' }}>TRAINING</span> PROVENANCE
              </h1>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Real-time Blockchain Audit Log | MNIST Prototype
              </p>
            </div>
          </div>
        </header>

        {loading ? (
          <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <p className="font-mono" style={{ color: 'var(--accent-cyan)' }}>INITIALIZING PROVENANCE ENGINE...</p>
          </div>
        ) : (steps.length === 0 && epochs.length === 0) ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: 'var(--text-secondary)' }}>
            <DatabaseZap size={48} opacity={0.3} />
            <p className="font-mono">NO AUDIT DATA DETECTED</p>
            <p style={{ fontSize: '0.8rem' }}>
              {selectedSessionId ? `Session ${selectedSessionId.substring(0,8)} is empty` : 'Run training to start capture'}
            </p>
          </div>
        ) : (
          <LineageMap 
            steps={steps} 
            epochs={epochs}
            selectedNode={selectedNode}
            onNodeClick={handleNodeClick}
            lineageVerifyResult={lineageResult}
          />
        )}
      </div>

      <IntegrityPanel
        selectionContext={selectionContext}
        selectedNode={selectedNode}
        onLineageVerified={(result) => {
          if (selectedSessionId && result) {
            lineageResultsRef.current[selectedSessionId] = result;
          }
          setLineageResult(result);
        }}
      />
    </div>
  );
}

export default App;
