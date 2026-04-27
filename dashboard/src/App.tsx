import React, { useState, useEffect } from 'react';
import './styles/theme.css';
import { fetchPackets, fetchSessions, type AuditPacket, type TrainingSession } from './services/api';
import LineageMap from './components/LineageMap';
import IntegrityPanel from './components/IntegrityPanel';
import { Terminal, DatabaseZap, History, Activity } from 'lucide-react';

function App() {
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [packets, setPackets] = useState<AuditPacket[]>([]);
  const [selectedPacket, setSelectedPacket] = useState<AuditPacket | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSessions = async () => {
    try {
      const data = await fetchSessions();
      setSessions(data);
      
      // FIX BUG 1: Only set the initial session if none is currently selected.
      // Using a functional update ensures we check the latest state and don't overwrite user selection.
      setSelectedSessionId(current => {
        if (!current && data.length > 0) {
          return data[0].session_id;
        }
        return current;
      });
    } catch (error) {
      console.error('[Dashboard Error] Failed to load sessions:', error);
    }
  };

  const loadPackets = async (sessionId: string) => {
    try {
      console.log(`[Dashboard] Fetching audit data for session ${sessionId}...`);
      const data = await fetchPackets(sessionId);
      
      if (data && Array.isArray(data)) {
        // Sort by step_id to ensure correct DAG flow
        const sorted = data.sort((a, b) => a.step_id - b.step_id);
        setPackets(sorted);
      }
    } catch (error) {
      console.error('[Dashboard Error] Failed to load packets:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      loadPackets(selectedSessionId);
      const interval = setInterval(() => loadPackets(selectedSessionId), 5000);
      return () => clearInterval(interval);
    }
  }, [selectedSessionId]);

  const handleSessionSelect = (sessionId: string) => {
    // FIX BUG 3: Clear selected packet when switching sessions to avoid confusion
    setSelectedPacket(null);
    setSelectedSessionId(sessionId);
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
                onClick={() => handleSessionSelect(s.session_id)}
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
          gap: '12px',
          background: 'rgba(10, 11, 16, 0.8)',
          width: '100%',
          borderBottom: '1px solid var(--border-color)',
          backdropFilter: 'blur(10px)'
        }}>
          <Terminal color="var(--accent-cyan)" size={28} />
          <div>
            <h1 style={{ fontSize: '1.2rem', letterSpacing: '2px', fontWeight: 900 }}>
              AI <span style={{ color: 'var(--accent-cyan)' }}>TRAINING</span> PROVENANCE
            </h1>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Real-time Blockchain Audit Log | MNIST Prototype
            </p>
          </div>
        </header>

        {loading && !selectedSessionId ? (
          <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <p className="font-mono" style={{ color: 'var(--accent-cyan)' }}>INITIALIZING DATA STREAMS...</p>
          </div>
        ) : packets.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: 'var(--text-secondary)' }}>
            <DatabaseZap size={48} opacity={0.3} />
            <p className="font-mono">NO AUDIT DATA DETECTED</p>
            <p style={{ fontSize: '0.8rem' }}>Run test_sdk.py to start training provenance capture</p>
          </div>
        ) : (
          <LineageMap packets={packets} onNodeClick={setSelectedPacket} />
        )}
      </div>

      <IntegrityPanel selectedPacket={selectedPacket} />
    </div>
  );
}

export default App;
