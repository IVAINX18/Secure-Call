import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useRole } from '../contexts/RoleContext';
import { Copy, Check } from 'lucide-react';
import RoleSelector from '../components/RoleSelector';
import EnhancedWebRTCRoom from '../components/EnhancedWebRTCRoom';
import { Button, Card, Tag } from '../components/ui';

const VideoCall: React.FC = () => {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const { user } = useAuth();
  const { role, setRole } = useRole();
  const [showRoleSelector, setShowRoleSelector] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleRoleSelect = () => {
    setShowRoleSelector(false);
  };

  const copyRoomCode = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEndCall = () => {
    setRole(null);
    navigate('/dashboard');
  };

  if (showRoleSelector) {
    return <RoleSelector onSelect={handleRoleSelect} />;
  }

  if (!roomId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-blush p-4 font-sans">
        <Card variant="paper" padding="lg" elevated className="w-full max-w-page text-center sm:max-w-md">
          <Tag>Secure Video Calls</Tag>
          <h2 className="mt-4 font-display text-[40px] font-normal leading-[1.15] text-ink">
            Invalid Room
          </h2>
          <p className="mt-2 text-base font-normal leading-relaxed text-ink/80">
            No room ID provided
          </p>
          <Button onClick={() => navigate('/dashboard')} className="mt-6 min-h-[44px]">
            Return to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative h-screen overflow-hidden bg-paper font-sans">
      <EnhancedWebRTCRoom
        userName={user?.username || 'Anonymous'}
        roomId={roomId}
        isHost={role === 'host'}
        onEndCall={handleEndCall}
      />

      {/* Room Info Overlay */}
      {role === 'host' && (
        <Card variant="mist" padding="sm" className="absolute bottom-20 left-4">
          <div className="flex min-h-[44px] items-center gap-2">
            <span className="text-sm font-medium text-ink">Room: {roomId}</span>
            <button
              type="button"
              onClick={copyRoomCode}
              aria-label="Copy room code"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-pill bg-iris px-3 text-paper transition-colors hover:bg-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30 focus-visible:ring-offset-2"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            </button>
            {copied && (
              <Tag aria-live="polite">
                Copied
              </Tag>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};

export default VideoCall;
