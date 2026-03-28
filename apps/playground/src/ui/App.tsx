import React, { useEffect, useMemo, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ControlBar,
  Chat,
  useConnectionState,
  useRoomContext,
  useLocalParticipant,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';

type ConfigResponse = {
  livekitUrl: string;
  defaultRoom: string;
  agentName: string;
};

type TokenResponse = {
  url: string;
  token: string;
  identity: string;
  name: string;
  room: string;
};

export function App() {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [room, setRoom] = useState('');
  const [name, setName] = useState('Patient');
  const [identity, setIdentity] = useState('');

  const [lkUrl, setLkUrl] = useState<string>('');
  const [token, setToken] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [dispatchStatus, setDispatchStatus] = useState<string>('');
  const [resetStatus, setResetStatus] = useState<string>('');
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/config');
        const json = (await res.json()) as ConfigResponse;
        if (cancelled) return;
        setCfg(json);
        setRoom(json.defaultRoom);
        setIdentity(`patient-${Math.random().toString(16).slice(2, 8)}`);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Failed to load config');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connected = Boolean(lkUrl && token);

  const connect = async () => {
    setError('');
    setDispatchStatus('');
    try {
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          room,
          name,
          identity: identity || undefined,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `token request failed (${res.status})`);
      }
      const json = (await res.json()) as TokenResponse;
      setLkUrl(json.url);
      setToken(json.token);
      setIdentity(json.identity);
    } catch (e: any) {
      setError(e?.message || 'Failed to connect');
    }
  };

  const disconnect = () => {
    setToken('');
    setLkUrl('');
    setDispatchStatus('');
  };

  const newConversation = async () => {
    setError('');
    setResetStatus('Starting a new conversation...');
    try {
      const sessionId = room && identity ? `${room}:${identity}` : '';
      const res = await fetch('/api/reset-conversation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId || undefined,
          patientId: identity || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `reset failed (${res.status})`);
      }
      setEvents([]);
      setToken('');
      setLkUrl('');
      setDispatchStatus('');
      setResetStatus('Conversation reset. You can connect again with a fresh turn.');
      setIdentity(`patient-${Math.random().toString(16).slice(2, 8)}`);
    } catch (e: any) {
      setResetStatus('');
      setError(e?.message || 'Reset failed');
    }
  };

  const dispatchAgent = async () => {
    setError('');
    setDispatchStatus('Dispatching Maya...');
    try {
      const res = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ room }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `dispatch failed (${res.status})`);
      }
      setDispatchStatus('Maya dispatched. She should join the room shortly.');
    } catch (e: any) {
      setDispatchStatus('');
      setError(e?.message || 'Dispatch failed');
    }
  };

  const header = useMemo(() => {
    return cfg ? `Maya LiveKit Playground (agentName: ${cfg.agentName})` : 'Maya LiveKit Playground';
  }, [cfg]);

  return (
    <div className="page">
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="brandTitle">{header}</div>
            <div className="brandSub">
              Connect as a web participant. Maya is auto-dispatched from the token config, matching the LiveKit Playground flow.
            </div>
          </div>
          <div className="topbarRight">
            {connected ? (
              <button className="btn btnGhost" onClick={disconnect}>
                Disconnect
              </button>
            ) : (
              <button className="btn" onClick={connect} disabled={!room}>
                Connect
              </button>
            )}
          </div>
        </header>

        <main className="main">
          <section className="panel">
            <div className="panelHeader">Connection</div>
            <div className="formRow">
              <label className="label">Room</label>
              <input
                className="input"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="clinical-appointments"
                disabled={connected}
              />
            </div>
            <div className="formRow">
              <label className="label">Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Patient"
                disabled={connected}
              />
            </div>
            <div className="formRow">
              <label className="label">Identity</label>
              <input
                className="input"
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                placeholder="patient-123"
                disabled={connected}
              />
            </div>

            <div className="actions">
              <button className="btn" onClick={connect} disabled={connected || !room}>
                Connect
              </button>
              <button className="btn btnGhost" onClick={dispatchAgent} disabled={!room}>
                Dispatch Maya
              </button>
              <button className="btn btnGhost" onClick={newConversation} disabled={!room}>
                New Conversation
              </button>
            </div>

            {dispatchStatus ? <div className="hint ok">{dispatchStatus}</div> : null}
            {resetStatus ? <div className="hint ok">{resetStatus}</div> : null}
            {error ? <div className="hint err">{error}</div> : null}
            <div className="hint">
              Tokens are served from <span className="mono">http://localhost:8787</span> and include the Maya agent dispatch.
              The UI is on <span className="mono">http://localhost:5173</span>.
            </div>
          </section>

          <section className="panel roomPanel">
            <div className="panelHeader">Room</div>
            {connected ? (
              <LiveKitRoom
                token={token}
                serverUrl={lkUrl}
                connect={true}
                video={false}
                audio={true}
                data-lk-theme="default"
                style={{ height: '100%', width: '100%' }}
              >
                <RoomBody onDispatchAgent={dispatchAgent} events={events} setEvents={setEvents} />
              </LiveKitRoom>
            ) : (
              <div className="empty">
                <div className="emptyTitle">Not connected</div>
                <div className="emptySub">Connect to a room to enable mic, chat, and auto-dispatched Maya audio.</div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function RoomBody(props: {
  onDispatchAgent: () => void;
  events: any[];
  setEvents: React.Dispatch<React.SetStateAction<any[]>>;
}) {
  const state = useConnectionState();
  const isConnected = state === ConnectionState.Connected;
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  useEffect(() => {
    const onData = (payload: Uint8Array, _p: any, _kind: any, topic?: string) => {
      if (topic !== 'maya.trace') return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        props.setEvents((prev) => [msg, ...prev].slice(0, 50));
      } catch {
        // ignore
      }
    };
    room.on('dataReceived' as any, onData);
    return () => {
      room.off('dataReceived' as any, onData);
    };
  }, [room, props.setEvents]);

  return (
    <div className="room">
      <div className="roomTop">
        <div className="roomBadge">
          {isConnected ? 'Connected' : state === ConnectionState.Connecting ? 'Connecting…' : 'Disconnected'}
        </div>
        <div className="roomActions">
          <button className="btn btnGhost" onClick={props.onDispatchAgent}>
            Dispatch Maya
          </button>
        </div>
      </div>

      <div className="roomMid">
        <AutoEnableMic />
        <DebugStrip
          micEnabled={Boolean(localParticipant.isMicrophoneEnabled)}
          audioPubCount={localParticipant.audioTrackPublications.length}
        />
        <TracePanel events={props.events} />
        <div className="chatWrap">
          <Chat />
        </div>
      </div>

      <div className="roomBottom">
        <ControlBar controls={{ camera: false, screenShare: false }} />
        <RoomAudioRenderer />
      </div>
    </div>
  );
}

function TracePanel(props: { events: any[] }) {
  if (!props.events.length) {
    return (
      <div className="tracePanel">
        <div className="traceTitle">Realtime Traces</div>
        <div className="traceEmpty">Speak after dispatching Maya. Traces and latency will appear here.</div>
      </div>
    );
  }

  const e = props.events[0];
  return (
    <div className="tracePanel">
      <div className="traceTitle">Realtime Traces</div>
      <div className="traceRow">
        <span className="traceK">TTFB</span>
        <span className="traceV">{typeof e.ttfbMs === 'number' ? `${e.ttfbMs}ms` : '-'}</span>
        <span className="traceK">Lang</span>
        <span className="traceV">{e.language || '-'}</span>
      </div>
      <div className="traceBlock">
        <div className="traceK">Transcript</div>
        <div className="traceText">{e.transcript || '-'}</div>
      </div>
      <div className="traceBlock">
        <div className="traceK">Normalized</div>
        <div className="traceText">{e.normalizedTranscript || '-'}</div>
      </div>
      <div className="traceBlock">
        <div className="traceK">Tools</div>
        <div className="traceText mono">{Array.isArray(e.toolCalls) ? e.toolCalls.join(', ') : '-'}</div>
      </div>
    </div>
  );
}

function AutoEnableMic() {
  const room = useRoomContext();
  const state = useConnectionState();

  useEffect(() => {
    if (state !== ConnectionState.Connected) return;
    // Mimic LiveKit Playground behavior: enable mic by default on connect.
    // If the browser blocks mic permission, the control bar will show the error state.
    room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
  }, [room, state]);

  return null;
}

function DebugStrip(props: { micEnabled: boolean; audioPubCount: number }) {
  const state = useConnectionState();
  const room = useRoomContext();

  const remoteCount = room.remoteParticipants.size;
  const me = room.localParticipant.identity;

  return (
    <div className="debugStrip">
      <div className="debugItem">
        <span className="debugK">State</span>
        <span className="debugV">{ConnectionState[state]}</span>
      </div>
      <div className="debugItem">
        <span className="debugK">Me</span>
        <span className="debugV mono">{me}</span>
      </div>
      <div className="debugItem">
        <span className="debugK">Mic</span>
        <span className={`debugV ${props.micEnabled ? 'ok' : 'err'}`}>{props.micEnabled ? 'On' : 'Off'}</span>
      </div>
      <div className="debugItem">
        <span className="debugK">Local audio pubs</span>
        <span className="debugV">{props.audioPubCount}</span>
      </div>
      <div className="debugItem">
        <span className="debugK">Remote</span>
        <span className="debugV">{remoteCount}</span>
      </div>
    </div>
  );
}
