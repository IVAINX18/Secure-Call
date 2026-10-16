import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, UserPlus, Copy, Check } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Button, Card, Input, Tag } from '../components/ui';

const Dashboard: React.FC = () => {
  const [roomId, setRoomId] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const generateRoomId = () => {
    return uuidv4().substring(0, 8);
  };

  const createNewCall = () => {
    const newRoomId = generateRoomId();
    navigate(`/video-call/${newRoomId}`);
  };

  const joinCall = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId.trim()) return;
    navigate(`/video-call/${roomId}`);
  };

  const toggleInvite = () => {
    if (!showInvite && !inviteCode) {
      setInviteCode(generateRoomId());
    }
    setShowInvite(!showInvite);
  };

  const copyRoomCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      {/* Hero band */}
      <section className="bg-blush">
        <div className="mx-auto max-w-page px-4 py-12 sm:px-6 md:py-16 lg:px-8">
          <Tag className="border-iris/30 text-ink">Secure Video Calls</Tag>
          <h1 className="mt-4 max-w-[20ch] font-display text-[40px] font-normal leading-[1.15] text-ink md:text-5xl">
            Video Calls
          </h1>
          <p className="mt-4 max-w-[65ch] text-base font-normal leading-relaxed text-ink/80">
            Start a new video call or join an existing one using a room code.
          </p>
          <Button onClick={createNewCall} className="mt-6 min-h-[44px]">
            <Video className="h-5 w-5" aria-hidden="true" />
            Start a Call
          </Button>
        </div>
      </section>

      {/* Main Content */}
      <section className="bg-mist">
        <div className="mx-auto max-w-page px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Start card */}
            <Card variant="paper" padding="lg">
              <h2 className="font-serif text-[28px] font-normal leading-[1.25] text-ink">
                Start a New Video Call
              </h2>
              <p className="mt-2 text-base font-normal leading-relaxed text-ink/80">
                Start a new video call or join an existing one using a room code.
              </p>
              <Button onClick={createNewCall} className="mt-6 min-h-[44px] w-full">
                <Video className="h-5 w-5" aria-hidden="true" />
                Start a New Video Call
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={toggleInvite}
                aria-expanded={showInvite}
                className="mt-4 min-h-[44px] w-full"
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Generate Room Code
              </Button>

              {showInvite && (
                <div className="mt-4 bg-mist p-4 rounded-card">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-ink">Share Room Code</h3>
                    <button
                      type="button"
                      onClick={() => setShowInvite(false)}
                      aria-label="Close share panel"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-pill text-ink/60 transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30"
                    >
                      <span className="sr-only">Close</span>
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M6.293 6.293a1 1 0 011.414 0L10 8.586l2.293-2.293a1 1 0 111.414 1.414L11.414 10l2.293 2.293a1 1 0 01-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 01-1.414-1.414L8.586 10 6.293 7.707a1 1 0 010-1.414z" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={inviteCode}
                      aria-label="Generated room code"
                      className="min-h-[44px] w-full min-w-0 flex-1 rounded-small border border-faded bg-paper px-3 py-2 text-base text-ink focus:border-iris focus:outline-none focus:ring-2 focus:ring-iris/30"
                    />
                    <button
                      type="button"
                      onClick={() => copyRoomCode(inviteCode)}
                      aria-label="Copy room code"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-pill bg-iris px-4 text-paper transition-colors hover:bg-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30 focus-visible:ring-offset-2"
                    >
                      {copied ? <Check className="h-5 w-5" aria-hidden="true" /> : <Copy className="h-5 w-5" aria-hidden="true" />}
                    </button>
                  </div>
                  {copied && (
                    <Tag className="mt-2" aria-live="polite">
                      Copied
                    </Tag>
                  )}
                </div>
              )}
            </Card>

            {/* Join card */}
            <Card variant="paper" padding="lg">
              <h2 className="font-serif text-[28px] font-normal leading-[1.25] text-ink">
                Join a Call
              </h2>
              <p className="mt-2 text-base font-normal leading-relaxed text-ink/80">
                or join existing call
              </p>
              <form onSubmit={joinCall} className="mt-6">
                <Input
                  label="Enter Room Code"
                  type="text"
                  id="room-code"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="Enter room code"
                />
                <Button type="submit" disabled={!roomId.trim()} className="mt-4 min-h-[44px] w-full">
                  Join Call
                </Button>
              </form>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
