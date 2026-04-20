import React, { useState, useEffect } from 'react';
import './styles/theme.css';
import { fetchPackets, type AuditPacket } from './services/api';
import LineageMap from './components/LineageMap';
import IntegrityPanel from './components/IntegrityPanel';
import { Terminal, DatabaseZap } from 'lucide-react';

function App() {
  const [packets, setPackets] = useState<AuditPacket[]>([]);
  const [selectedPacket, setSelectedPacket] = useState<AuditPacket | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      console.log('[Dashboard] Fetching audit data...');
      const data = await fetchPackets();
      
      if (data && Array.isArray(data)) {
        // Sort by step_id to ensure correct DAG flow
        const sorted = data.sort((a, b) => a.step_id - b.step_id);
        setPackets(sorted);
      } else {
        console.warn('[Dashboard] Received invalid data format:', data);
      }
    } catch (error) {
      console.error('[Dashboard Error] Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Poll for new packets every 5 seconds during training
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="dashboard-container">
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

        {loading ? (
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
