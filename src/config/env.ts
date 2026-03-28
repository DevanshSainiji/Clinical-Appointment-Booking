import 'dotenv/config';

export type AppEnv = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitRoom: string;
  livekitAgentName: string;
  port: number;
  sarvamApiKey?: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  anthropicMaxTokens: number;
  anthropicTemperature: number;
};

export function loadEnv(): AppEnv {
  const livekitUrl = requireEnv('LIVEKIT_URL');
  const livekitApiKey = requireEnv('LIVEKIT_API_KEY');
  const livekitApiSecret = requireEnv('LIVEKIT_API_SECRET');

  return {
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
    livekitRoom: process.env.LIVEKIT_ROOM?.trim() || 'clinical-appointments',
    livekitAgentName: process.env.LIVEKIT_AGENT_NAME?.trim() || 'maya',
    port: parseInt(process.env.PORT || '8787', 10),
    sarvamApiKey: process.env.SARVAM_API_KEY?.trim() || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined,
    anthropicModel: process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5',
    anthropicMaxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '700', 10),
    anthropicTemperature: Number(process.env.ANTHROPIC_TEMPERATURE || '0.2'),
  };
}

export function livekitHttpHost(url: string): string {
  if (url.startsWith('wss://')) return `https://${url.slice('wss://'.length)}`;
  if (url.startsWith('ws://')) return `http://${url.slice('ws://'.length)}`;
  return url;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

