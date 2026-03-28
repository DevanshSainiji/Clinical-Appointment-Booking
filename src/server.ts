import express from 'express';
import cors from 'cors';
import { AccessToken, AgentDispatchClient, RoomAgentDispatch, RoomConfiguration, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { loadEnv, livekitHttpHost } from './config/env.js';
import { clearPatientConversation, clearSessionMemory } from './memory/sessionMemory.js';
import { logger } from './telemetry/logger.js';

const env = loadEnv();
const app = express();
const httpHost = livekitHttpHost(env.livekitUrl);

type DispatchRecord = {
  id?: string;
  agentName?: string;
  room?: string;
  deletedAt?: string | number | null;
  state?: { jobs?: unknown[] };
};

async function ensureAgentDispatch(room: string, agentName: string) {
  const roomClient = new RoomServiceClient(httpHost, env.livekitApiKey, env.livekitApiSecret);
  await roomClient.createRoom({ name: room }).catch(() => {});

  const dispatchClient = new AgentDispatchClient(httpHost, env.livekitApiKey, env.livekitApiSecret);
  const existing = (await dispatchClient.listDispatch(room).catch(() => [])) as DispatchRecord[];
  const current = existing.find(
    (dispatch) =>
      dispatch.agentName === agentName &&
      dispatch.room === room &&
      String(dispatch.deletedAt ?? '0') === '0',
  );

  if (current) {
    logger.info('server', 'dispatch_exists', {
      room,
      agentName,
      dispatchId: current.id || null,
    });
    return { dispatch: current, existing: true };
  }

  const created = await dispatchClient.createDispatch(room, agentName, {
    metadata: JSON.stringify({ room }),
  });
  return { dispatch: created, existing: false };
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.type('html').send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Maya API</title>
        <style>
          body { font-family: ui-sans-serif, system-ui, sans-serif; background:#0b1020; color:#e5eefc; margin:0; padding:32px; }
          .card { max-width: 720px; margin: 0 auto; background: rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.12); border-radius:18px; padding:24px; }
          code { background: rgba(255,255,255,.08); padding:2px 6px; border-radius:6px; }
          a { color:#8bd5ff; }
          ul { line-height:1.7; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Maya API is running</h1>
          <p>This port serves token and dispatch endpoints. It is not the browser UI.</p>
          <ul>
            <li>Health: <code>/health</code></li>
            <li>Token: <code>POST /api/token</code></li>
            <li>Dispatch: <code>POST /api/dispatch</code></li>
            <li>Local UI: <a href="http://localhost:5173">http://localhost:5173</a></li>
          </ul>
          <p>Run <code>pnpm start:worker</code> for Maya and <code>pnpm dev:web</code> for the UI.</p>
        </div>
      </body>
    </html>
  `);
});

app.get('/health', (_req, res) => {
  logger.debug('server', 'health_check');
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  logger.info('server', 'config_requested', {
    livekitUrl: env.livekitUrl,
    room: env.livekitRoom,
    agentName: env.livekitAgentName,
  });
  res.json({
    livekitUrl: env.livekitUrl,
    defaultRoom: env.livekitRoom,
    agentName: env.livekitAgentName,
    autoDispatch: true,
  });
});

app.post('/api/token', async (req, res) => {
  const room = String(req.body?.room || env.livekitRoom).trim();
  const identity = String(req.body?.identity || `guest-${Math.random().toString(36).slice(2, 8)}`).trim();
  const name = String(req.body?.name || identity).trim();

  logger.info('server', 'token_requested', { room, identity, name, agentName: env.livekitAgentName });

  const token = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity,
    name,
  });
  token.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE],
  });

  const roomConfig = new RoomConfiguration({ name: room });
  roomConfig.agents = [
    new RoomAgentDispatch({
      agentName: env.livekitAgentName,
      metadata: JSON.stringify({ room, source: 'roomConfig' }),
    }),
  ];
  token.roomConfig = roomConfig;

  try {
    const dispatch = await ensureAgentDispatch(room, env.livekitAgentName);
    logger.info('server', 'token_dispatch_ready', {
      room,
      agentName: env.livekitAgentName,
      dispatchId: dispatch.dispatch.id || null,
      existing: dispatch.existing,
    });
  } catch (err: any) {
    logger.warn('server', 'token_dispatch_failed', {
      room,
      agentName: env.livekitAgentName,
      error: err?.message || 'dispatch failed',
    });
  }

  res.json({
    url: env.livekitUrl,
    token: await token.toJwt(),
    identity,
    name,
    room,
    agentName: env.livekitAgentName,
  });
});

app.post('/api/dispatch', async (req, res) => {
  const room = String(req.body?.room || env.livekitRoom).trim();
  const agentName = String(req.body?.agentName || env.livekitAgentName).trim();

  logger.info('server', 'dispatch_requested', { room, agentName });

  try {
    const result = await ensureAgentDispatch(room, agentName);
    logger.info('server', 'dispatch_created', {
      room,
      agentName,
      dispatchId: result.dispatch.id || null,
      existing: result.existing,
    });
    res.json({ ok: true, dispatch: result.dispatch, room, existing: result.existing });
  } catch (err: any) {
    logger.error('server', 'dispatch_failed', {
      room,
      agentName,
      error: err?.message || 'dispatch failed',
    });
    res.status(500).json({ ok: false, error: err?.message || 'dispatch failed' });
  }
});

app.post('/api/reset-conversation', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  const patientId = String(req.body?.patientId || '').trim();
  logger.info('server', 'reset_conversation_requested', { sessionId: sessionId || null, patientId: patientId || null });

  try {
    if (sessionId) {
      await clearSessionMemory(sessionId);
    }
    if (patientId) {
      await clearPatientConversation(patientId);
    }
    res.json({ ok: true, sessionId: sessionId || null, patientId: patientId || null });
  } catch (err: any) {
    logger.error('server', 'reset_conversation_failed', {
      sessionId: sessionId || null,
      patientId: patientId || null,
      error: err?.message || 'reset failed',
    });
    res.status(500).json({ ok: false, error: err?.message || 'reset failed' });
  }
});

app.listen(env.port, () => {
  logger.info('server', 'listening', {
    port: env.port,
    livekitUrl: env.livekitUrl,
    livekitHttpHost: httpHost,
    defaultRoom: env.livekitRoom,
    defaultAgentName: env.livekitAgentName,
  });
});
