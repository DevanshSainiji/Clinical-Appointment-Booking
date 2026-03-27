import { VoiceAgent } from './runtime/voiceAgent.js';
import { connectDB } from './services/db.js';

type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
  roomName: string;
};

function readLiveKitConfig(): LiveKitConfig {
  return {
    url: process.env.LIVEKIT_URL ?? '',
    apiKey: process.env.LIVEKIT_API_KEY ?? '',
    apiSecret: process.env.LIVEKIT_API_SECRET ?? '',
    roomName: process.env.LIVEKIT_ROOM ?? 'clinical-appointments',
  };
}

async function bootstrap(): Promise<void> {
  await connectDB();
  const liveKit = readLiveKitConfig();
  const agent = new VoiceAgent();
  await agent.start(liveKit);
}

void bootstrap();
