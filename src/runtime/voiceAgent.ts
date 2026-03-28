import { runOrchestrationTurn } from '../orchestration/orchestrator.js';
import { transcribeAudio } from '../services/stt.js';
import { synthesizeSpeech } from '../services/tts.js';
import { markFirstAudioByte, markSpeechEnd, resetLatencyMarks } from '../telemetry/latency.js';
import { Room, RoomEvent, type Participant, AudioSource, LocalAudioTrack, AudioStream, AudioFrame } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { VADEventType } from '@livekit/agents';
import { VAD } from '@livekit/agents-plugin-silero';
import pkg from 'wavefile';
const { WaveFile } = pkg;

type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
  roomName: string;
};

export type VoiceTurnResult = {
  transcript: string;
  responseText: string;
  audio: Uint8Array;
};

export class VoiceAgent {
  private room: Room | null = null;
  private audioSource: AudioSource | null = null;
  private agentPlaying = false;
  private greetingSent = false;

  async startWithRoom(room: Room): Promise<void> {
    this.room = room;

    this.audioSource = new AudioSource(24000, 1);
    const track = LocalAudioTrack.createAudioTrack('agent-mic', this.audioSource);
    await room.localParticipant?.publishTrack(track, { name: 'agent-mic' } as any);

    console.info(`LiveKit agent joined room "${room.name}"`);

    room.on(RoomEvent.ChatMessage, async (message, participant) => {
      await this.handleChatMessage(message.message, participant);
    });

    room.on(RoomEvent.DataReceived, async (payload, participant, _kind, topic) => {
      const maybeTranscript = this.extractTranscriptFromData(payload, topic);
      if (maybeTranscript) {
        await this.handleChatMessage(maybeTranscript, participant);
      }
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log(`[Room] Participant connected: ${participant.identity}`);
      if (!this.greetingSent) {
        this.greetingSent = true;
        this.triggerGreeting(participant).catch(console.error);
      }
    });

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      console.log(`[Audio Pipeline] Track subscribed: kind=${track.kind} from pt=${participant.identity}`);

      if (track.kind === 1) { // 1 = Audio
        this.handleAudioStream(track as any, participant).catch(console.error);
      }
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      console.warn(`LiveKit disconnected: ${reason}`);
    });

    // If a participant is already in the room when the agent joins via the Playground dispatch
    if (room.remoteParticipants.size > 0 && !this.greetingSent) {
      const firstParticipant = Array.from(room.remoteParticipants.values())[0];
      if (firstParticipant) {
        this.greetingSent = true;
        this.triggerGreeting(firstParticipant).catch(console.error);
      }
    }
  }

  private async handleAudioStream(track: any, participant: Participant) {
    const stream = new AudioStream(track);
    const vad = await VAD.load();
    const vadStream = vad.stream();

    let isSpeaking = false;
    let audioFrames: AudioFrame[] = [];

    const reader = stream.getReader();

    // Asynchronously push frames from LiveKit incoming stream to VAD
    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        vadStream.pushFrame(value);
        if (isSpeaking && !this.agentPlaying) {
          audioFrames.push(value);
        }
      }
    })();

    // Listen to VAD events and chunk
    for await (const event of vadStream) {
      if (event.type === VADEventType.START_OF_SPEECH) {
        if (!this.agentPlaying) {
          console.log(`[VAD] Start of speech detected from ${participant.identity}`);
          isSpeaking = true;
          audioFrames = [];
        }
      } else if (event.type === VADEventType.END_OF_SPEECH) {
        console.log(`[VAD] End of speech detected. Collected ${audioFrames.length} frames.`);
        isSpeaking = false;

        if (audioFrames.length > 5) {
          console.log(`[Audio Pipeline] Stitching WAV buffer from frames...`);
          const combined = this.combineFrames(audioFrames);
          const wav = new WaveFile();
          wav.fromScratch(1, combined.sampleRate, '16', combined.data);
          const wavBuffer = wav.toBuffer();

          const sessionId = `${this.room!.name}:${participant.identity}`;
          console.log(`[Audio Pipeline] Dispatching audio to STT...`);
          const turnStartTime = Date.now();
          this.processAudioTurn(wavBuffer, sessionId, participant.identity)
            .then(result => {
              const latencyMs = Date.now() - turnStartTime;
              console.log(`[Latency] End-to-end TTFB: ${latencyMs}ms`);
              console.log(`[Audio Pipeline] Playing audio response...`);
              return this.playAudio(result.audio);
            })
            .catch(e => console.error("[Error] Processing audio turn failed", e));
        }
        audioFrames = [];
      }
    }
  }

  private combineFrames(frames: AudioFrame[]): { data: Int16Array, sampleRate: number } {
    const totalLength = frames.reduce((acc, f) => acc + (f.data.byteLength / 2), 0);
    const combinedData = new Int16Array(totalLength);
    let offset = 0;
    for (const f of frames) {
      const pcm16 = new Int16Array(f.data.buffer, f.data.byteOffset, f.data.byteLength / 2);
      combinedData.set(pcm16, offset);
      offset += pcm16.length;
    }
    return { data: combinedData, sampleRate: frames[0].sampleRate };
  }

  private async playAudio(ttsBuffer: Uint8Array) {
    this.agentPlaying = true;
    try {
      if (ttsBuffer.length === 0) return;
      const wav = new WaveFile(ttsBuffer);
      wav.toSampleRate(24000);
      wav.toBitDepth('16');
      const samples = wav.getSamples(false, Int16Array) as unknown as Int16Array;

      const frame = new AudioFrame(samples, 24000, 1, samples.length);
      await this.audioSource?.captureFrame(frame);
    } catch (e) {
      console.error("Error decoding or playing audio:", e);
    } finally {
      this.agentPlaying = false;
    }
  }

  async processAudioTurn(audio: Uint8Array, sessionId: string, patientId: string): Promise<VoiceTurnResult> {
    resetLatencyMarks();
    markSpeechEnd(Date.now());

    const transcription = await transcribeAudio(audio);
    const orchestration = await runOrchestrationTurn({
      sessionId,
      patientId,
      userText: transcription.text,
      language: transcription.language,
    });

    const synthesizedAudio = await synthesizeSpeech(orchestration.responseText, orchestration.language);
    markFirstAudioByte(Date.now());

    return {
      transcript: transcription.text,
      responseText: orchestration.responseText,
      audio: synthesizedAudio,
    };
  }


  private async handleChatMessage(text: string, participant?: Participant): Promise<void> {
    if (!participant || !this.room?.localParticipant || !text.trim()) {
      return;
    }

    if (participant.identity === this.room.localParticipant.identity) {
      return;
    }

    const sessionId = `${this.room.name}:${participant.identity}`;
    const patientId = participant.identity;

    const orchestration = await runOrchestrationTurn({
      sessionId,
      patientId,
      userText: text,
      language: participant.attributes?.language,
    });

    await this.room.localParticipant.sendChatMessage(orchestration.responseText, [participant.identity]);
  }

  private async triggerGreeting(participant: Participant) {
    if (!this.room?.localParticipant) return;

    const sessionId = `${this.room.name}:${participant.identity}`;
    const patientId = participant.identity;

    console.log(`[Audio Pipeline] Triggering initial vocal greeting...`);
    const orchestration = await runOrchestrationTurn({
      sessionId,
      patientId,
      userText: "System: The user just joined. Greet them EXACTLY with the phrase 'Hello there, this is Maya speaking are you here for a clinical-appointment.' and nothing else. Keep it simple and friendly.",
    });

    await this.room.localParticipant.sendChatMessage(orchestration.responseText, [participant.identity]);

    console.log(`[Audio Pipeline] Synthesizing greeting audio...`);
    const synthesizedAudio = await synthesizeSpeech(orchestration.responseText, orchestration.language);

    console.log(`[Audio Pipeline] Playing greeting audio...`);
    await this.playAudio(synthesizedAudio);
  }

  private extractTranscriptFromData(payload: Uint8Array, topic?: string): string | null {
    if (topic && !topic.includes('transcript') && !topic.includes('text') && !topic.includes('chat')) {
      return null;
    }

    const raw = new TextDecoder().decode(payload).trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as { text?: string; message?: string };
      return parsed.text?.trim() ?? parsed.message?.trim() ?? null;
    } catch {
      return raw;
    }
  }
}
