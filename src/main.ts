import 'dotenv/config';
import { fileURLToPath } from 'url';
import { cli, defineAgent, type JobContext, WorkerOptions, voice, AutoSubscribe } from '@livekit/agents';
import { VAD } from '@livekit/agents-plugin-silero';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as google from '@livekit/agents-plugin-google';
import { IceTransportType, ContinualGatheringPolicy } from '@livekit/rtc-node';
import { connectDB } from './services/db.js';

console.log('[Boot] Loading environment variables...');
if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
  console.error('[Boot] Missing LiveKit credentials in .env');
  process.exit(1);
}
console.log('[Boot] Environment OK ✓');

// Connect to DB once when the worker starts
console.log('[Boot] Connecting to MongoDB...');
connectDB().catch(err => {
  console.error('[Boot] MongoDB connection failed:', err);
});

export default defineAgent({
  entry: async (ctx: JobContext) => {
    console.log(`[Worker] Received job ${ctx.job.id}`);
    
    // Force TURN relay to bypass NAT publisher connection timeout
    console.log('[Agent] Connecting to LiveKit room...');
    await ctx.connect(
      undefined,
      AutoSubscribe.SUBSCRIBE_ALL,
      {
        iceTransportType: IceTransportType.TRANSPORT_RELAY,
        continualGatheringPolicy: ContinualGatheringPolicy.GATHER_CONTINUALLY,
        iceServers: [],
      }
    );
    console.log(`[Room] Connected to "${ctx.room.name}"`);

    console.log('[Agent] Loading Silero VAD model...');
    const vad = await VAD.load();
    console.log('[Agent] VAD loaded ✓');

    console.log('[Agent] Initialising Deepgram STT (nova-3)...');
    const stt = new deepgram.STT({
      model: 'nova-3',
      language: 'en',
    });
    console.log('[Agent] STT ready ✓');

    console.log('[Agent] Initialising Google Gemini LLM (gemini-2.5-flash)...');
    const llm = new google.LLM({
      model: 'gemini-2.5-flash',
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    });
    console.log('[Agent] LLM ready ✓');

    console.log('[Agent] Initialising Cartesia TTS (sonic)...');
    const tts = new cartesia.TTS({
      model: 'sonic',
      language: 'en',
    });
    console.log('[Agent] TTS ready ✓');

    // Create the agent with all pipeline components
    const agent = new voice.Agent({
      instructions:
        'You are Maya, a friendly clinical appointment booking assistant. ' +
        'You help patients book, reschedule, and cancel appointments. ' +
        'Keep your responses conversational and brief since this is a voice conversation. ' +
        'Follow the user\'s lead on language (English, Hindi, or Tamil).',
      vad,
      stt,
      llm,
      tts,
    });

    console.log('[Agent] Pipeline created (VAD + STT + LLM + TTS)');

    // Create the session and start
    const session = new voice.AgentSession({});
    await session.start({ agent, room: ctx.room });
    console.log('[Session] Voice session started');

    // Wait for WebRTC publisher connection to fully establish
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Trigger the initial greeting
    session.say('Hello there, this is Maya.');
    console.log('[Session] Greeting triggered ✓');
  },
});

console.log('[Boot] Starting LiveKit worker...');
cli.runApp(new WorkerOptions({
  agent: fileURLToPath(import.meta.url),
}));
