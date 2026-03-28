import { fileURLToPath } from 'node:url';
import { cli, defineAgent, type JobContext, WorkerOptions, AutoSubscribe } from '@livekit/agents';
import { IceTransportType, ContinualGatheringPolicy } from '@livekit/rtc-node';
import { loadEnv } from './config/env.js';
import { VoiceAgent } from './runtime/voiceAgent.js';
import { logger } from './telemetry/logger.js';

const env = loadEnv();
logger.info('worker', 'boot', { agentName: env.livekitAgentName, livekitUrl: env.livekitUrl, room: env.livekitRoom });

export default defineAgent({
  entry: async (ctx: JobContext) => {
    logger.info('worker', 'job_received', { jobId: ctx.job.id, room: ctx.room?.name, agentName: env.livekitAgentName });
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL, {
      iceTransportType: IceTransportType.TRANSPORT_RELAY,
      continualGatheringPolicy: ContinualGatheringPolicy.GATHER_CONTINUALLY,
      iceServers: [],
    });
    logger.info('worker', 'room_connected', {
      jobId: ctx.job.id,
      room: ctx.room.name,
      remoteParticipants: ctx.room.remoteParticipants.size,
    });

    const agent = new VoiceAgent();
    await agent.startWithRoom(ctx.room);
  },
});

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: env.livekitAgentName,
  }),
);
