import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check } from 'lucide-react';

interface TooltipProps {
  content: React.ReactNode;
  copyValue?: string;
  children: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({ content, copyValue, children }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top - 5, 
        left: rect.left + rect.width / 2
      });
    }
  };

  const handleMouseEnter = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    updatePosition();
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    leaveTimer.current = setTimeout(() => {
      setIsVisible(false);
      setCopied(false);
    }, 200);
  };

  const handleCopy = async () => {
    if (copyValue) {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div 
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ display: 'inline-block' }}
    >
      {children}
      {isVisible && createPortal(
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            position: 'fixed',
            top: `${position.top}px`,
            left: `${position.left}px`,
            transform: 'translate(-50%, -100%)',
            zIndex: 10000,
            paddingBottom: '10px',
            background: 'transparent',
          }}
        >
          <div style={{
            backgroundColor: '#14161e',
            border: '1px solid #00f2ff',
            padding: '10px 14px',
            borderRadius: '4px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.9)',
            width: 'max-content',
            maxWidth: '280px',
            position: 'relative'
          }}>
            <div style={{
              fontSize: '11px',
              color: '#fff',
              whiteSpace: 'normal',
              wordBreak: 'break-all',
              overflowWrap: 'anywhere'
            }}>
              {content}
            </div>
            {copyValue && (
              <button
                onClick={handleCopy}
                style={{
                  marginTop: '10px',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  background: copied ? 'rgba(74, 222, 128, 0.1)' : 'rgba(0, 242, 255, 0.1)',
                  border: `1px solid ${copied ? '#4ade80' : '#00f2ff'}`,
                  color: copied ? '#4ade80' : '#00f2ff',
                  padding: '4px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '10px'
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'SUCCESS' : 'COPY FULL HASH'}
              </button>
            )}
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              borderWidth: '5px',
              borderStyle: 'solid',
              borderColor: '#00f2ff transparent transparent transparent'
            }} />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Tooltip;