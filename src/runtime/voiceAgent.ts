import { runOrchestrationTurn } from '../orchestration/orchestrator.js';
import { detectLanguage } from '../orchestration/intentRouter.js';
import { greetingPrompt } from '../config/prompts.js';
import { transcribeAudio } from '../services/stt.js';
import { synthesizeSpeech } from '../services/tts.js';
import { translateForReasoning } from '../services/translation.js';
import { markFirstAudioByte, markSpeechEnd, resetLatencyMarks } from '../telemetry/latency.js';
import { recordReasoningTrace } from '../telemetry/traces.js';
import { logger } from '../telemetry/logger.js';
import { Room, RoomEvent, type Participant, AudioSource, LocalAudioTrack, AudioStream, AudioFrame, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { VAD, type VADStream } from '@livekit/agents-plugin-silero';
import { VADEventType } from '@livekit/agents';
import pkg from 'wavefile';

const { WaveFile } = pkg;

type TurnPayload = {
  transcript: string;
  responseText: string;
  audio: Uint8Array;
  language: 'en' | 'hi' | 'ta';
  ttfbMs: number;
  toolCalls: Array<{ name: string; input: unknown; result: unknown }>;
};

export class VoiceAgent {
  private room: Room | null = null;
  private audioSource: AudioSource | null = null;
  private agentPlaying = false;
  private greetingSent = false;
  private playbackChain: Promise<void> = Promise.resolve();

  async startWithRoom(room: Room): Promise<void> {
    this.room = room;
    logger.info('voice', 'room_start', { room: room.name, remoteParticipants: room.remoteParticipants.size });
    this.audioSource = new AudioSource(24000, 1);
    const track = LocalAudioTrack.createAudioTrack('maya-speaker', this.audioSource);
    if (!room.localParticipant) {
      throw new Error('LiveKit room has no local participant.');
    }
    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant.publishTrack(track, publishOptions);
    logger.info('voice', 'audio_track_published', { room: room.name, trackName: 'maya-speaker' });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      logger.info('voice', 'participant_connected', {
        room: room.name,
        participantIdentity: participant.identity,
        participantName: participant.name || null,
      });
      if (!this.greetingSent) {
        this.greetingSent = true;
        this.greet(participant).catch(console.error);
      }
    });

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      logger.info('voice', 'track_subscribed', {
        room: room.name,
        participantIdentity: participant.identity,
        kind: track.kind,
      });
      if (track.kind === 1) {
        this.handleParticipantAudio(track as any, participant).catch(console.error);
      }
    });

    room.on(RoomEvent.ChatMessage, async (message, participant) => {
      logger.info('voice', 'chat_message', {
        room: room.name,
        participantIdentity: participant?.identity || null,
        preview: message.message.slice(0, 200),
      });
      await this.handleTextTurn(message.message, participant);
    });

    room.on(RoomEvent.DataReceived, async (payload, participant, _kind, topic) => {
      logger.debug('voice', 'data_received', {
        room: room.name,
        participantIdentity: participant?.identity || null,
        topic: topic || null,
        bytes: payload.byteLength,
      });
      if (topic?.includes('transcript') || topic?.includes('chat') || topic?.includes('text')) {
        const raw = new TextDecoder().decode(payload).trim();
        if (raw) await this.handleTextTurn(raw, participant);
      }
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      logger.warn('voice', 'room_disconnected', { room: room.name, reason });
    });

    if (room.remoteParticipants.size > 0 && !this.greetingSent) {
      const first = Array.from(room.remoteParticipants.values())[0];
      if (first) {
        this.greetingSent = true;
        this.greet(first).catch(console.error);
      }
    }

    logger.info('voice', 'agent_joined_room', { room: room.name });
  }

  private async handleParticipantAudio(track: any, participant: Participant): Promise<void> {
    logger.info('voice', 'audio_stream_start', {
      room: this.room?.name || null,
      participantIdentity: participant.identity,
    });
    const stream = new AudioStream(track);
    const vad = await VAD.load();
    const vadStream = vad.stream();
    const reader = stream.getReader();

    const buffer: AudioFrame[] = [];
    let speaking = false;

    const pump = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        vadStream.pushFrame(value);
        if (speaking && !this.agentPlaying) buffer.push(value);
      }
    })();

    for await (const event of vadStream) {
      if (event.type === VADEventType.START_OF_SPEECH) {
        if (!this.agentPlaying) {
          logger.debug('voice', 'vad_start_of_speech', {
            participantIdentity: participant.identity,
            room: this.room?.name || null,
          });
          speaking = true;
          buffer.length = 0;
        }
      }

      if (event.type === VADEventType.END_OF_SPEECH) {
        logger.debug('voice', 'vad_end_of_speech', {
          participantIdentity: participant.identity,
          collectedFrames: buffer.length,
          room: this.room?.name || null,
        });
        speaking = false;
        if (buffer.length > 5) {
          const wav = this.framesToWav(buffer);
          buffer.length = 0;
          this.processAudioTurn(wav, participant).catch(console.error);
        }
      }
    }

    await pump;
  }

  private async handleTextTurn(text: string, participant?: Participant): Promise<void> {
    if (!this.room?.localParticipant || !participant || !text.trim()) return;
    if (participant.identity === this.room.localParticipant.identity) return;

    const detectedLanguage = detectLanguage(text);
    const normalized = await translateForReasoning(text.trim(), detectedLanguage);
    logger.info('voice', 'text_turn_start', {
      room: this.room.name,
      participantIdentity: participant.identity,
      textPreview: text.trim().slice(0, 200),
      detectedLanguage,
      normalizedPreview: normalized.translatedText.slice(0, 200),
    });

    if (isLowValueTranscript(text, undefined)) {
      logger.debug('voice', 'text_turn_ignored', {
        room: this.room.name,
        participantIdentity: participant.identity,
        reason: 'low_value_transcript',
        transcript: text.trim(),
      });
      await this.askToRepeat(participant, detectedLanguage, 'text');
      return;
    }

    const turn = await runOrchestrationTurn({
      sessionId: `${this.room.name}:${participant.identity}`,
      patientId: participant.identity,
      userText: text.trim(),
      normalizedUserText: normalized.translatedText,
      language: normalizeLanguage(participant.attributes?.language) || detectedLanguage,
    });

    await this.room.localParticipant.sendChatMessage(turn.responseText, [participant.identity]);
    logger.info('voice', 'text_turn_complete', {
      room: this.room.name,
      participantIdentity: participant.identity,
      responsePreview: turn.responseText.slice(0, 200),
      toolCalls: turn.toolCalls.map((tool) => tool.name),
    });
    await this.publishTrace({
      kind: 'text-turn',
      patientId: participant.identity,
      sessionId: `${this.room.name}:${participant.identity}`,
      transcript: text.trim(),
      normalizedTranscript: normalized.translatedText,
      responseText: turn.responseText,
      toolCalls: turn.toolCalls.map((tool) => tool.name),
      ttfbMs: undefined,
      timestampIso: new Date().toISOString(),
      language: turn.language,
    });
  }

  private async processAudioTurn(audio: Uint8Array, participant: Participant): Promise<void> {
    if (!this.room?.localParticipant) return;

    const sessionId = `${this.room.name}:${participant.identity}`;
    logger.info('voice', 'audio_turn_start', {
      room: this.room.name,
      participantIdentity: participant.identity,
      sessionId,
      audioBytes: audio.byteLength,
    });
    resetLatencyMarks(sessionId);
    markSpeechEnd(sessionId);

    const sttStart = Date.now();
    const transcription = await transcribeAudio(audio);
    const normalized = await translateForReasoning(transcription.text, transcription.language);
    logger.info('voice', 'stt_complete', {
      sessionId,
      participantIdentity: participant.identity,
      ms: Date.now() - sttStart,
      transcriptPreview: transcription.text.slice(0, 200),
      language: transcription.language,
      confidence: transcription.confidence ?? null,
      normalizedPreview: normalized.translatedText.slice(0, 200),
    });

    if (isLowValueTranscript(transcription.text, transcription.confidence)) {
      logger.warn('voice', 'audio_turn_ignored', {
        sessionId,
        participantIdentity: participant.identity,
        transcript: transcription.text,
        confidence: transcription.confidence ?? null,
        language: transcription.language,
      });
      await this.askToRepeat(participant, transcription.language, 'audio');
      await this.publishTrace({
        kind: 'audio-turn',
        sessionId,
        patientId: participant.identity,
        transcript: transcription.text,
        normalizedTranscript: normalized.translatedText,
        responseText: '',
        toolCalls: [],
        ttfbMs: undefined,
        timestampIso: new Date().toISOString(),
        language: transcription.language,
        ignored: true,
        reason: 'low_value_transcript',
      });
      return;
    }

    const orchestrationStart = Date.now();
    const orchestration = await runOrchestrationTurn({
      sessionId,
      patientId: participant.identity,
      userText: transcription.text,
      normalizedUserText: normalized.translatedText,
      language: transcription.language,
    });
    logger.info('voice', 'orchestration_complete', {
      sessionId,
      participantIdentity: participant.identity,
      ms: Date.now() - orchestrationStart,
      intent: orchestration.intent,
      responsePreview: orchestration.responseText.slice(0, 200),
      toolCalls: orchestration.toolCalls.map((tool) => tool.name),
    });

    const ttsStart = Date.now();
    const speech = await synthesizeSpeech(orchestration.responseText, orchestration.language);
    logger.info('voice', 'tts_complete', {
      sessionId,
      participantIdentity: participant.identity,
      ms: Date.now() - ttsStart,
      audioBytes: speech.byteLength,
    });
    const ttfbMs = markFirstAudioByte(sessionId) ?? 0;
    const payload: TurnPayload = {
      transcript: transcription.text,
      responseText: orchestration.responseText,
      audio: speech,
      language: orchestration.language,
      ttfbMs,
      toolCalls: orchestration.toolCalls,
    };

    await this.publishTrace({
      kind: 'audio-turn',
      sessionId,
      patientId: participant.identity,
      transcript: payload.transcript,
      normalizedTranscript: normalized.translatedText,
      responseText: payload.responseText,
      toolCalls: payload.toolCalls.map((tool) => tool.name),
      ttfbMs,
      timestampIso: new Date().toISOString(),
      language: payload.language,
    });

    await this.enqueueAudio(payload.audio);
    logger.info('voice', 'audio_turn_complete', {
      sessionId,
      participantIdentity: participant.identity,
      ttfbMs,
      responsePreview: payload.responseText.slice(0, 200),
      audioBytes: payload.audio.byteLength,
    });
  }

  private async greet(participant: Participant): Promise<void> {
    if (!this.room?.localParticipant) return;
    logger.info('voice', 'greeting_start', {
      room: this.room.name,
      participantIdentity: participant.identity,
    });
    const language = normalizeLanguage(participant.attributes?.language) || 'en';
    const turn: Pick<TurnPayload, 'responseText' | 'language'> & { toolCalls: TurnPayload['toolCalls'] } = {
      responseText: greetingPrompt(language),
      language,
      toolCalls: [],
    };

    await this.room.localParticipant.sendChatMessage(turn.responseText, [participant.identity]);
    logger.info('voice', 'greeting_chat_sent', {
      room: this.room.name,
      participantIdentity: participant.identity,
      responsePreview: turn.responseText.slice(0, 200),
    });
    await this.publishTrace({
      kind: 'greeting',
      sessionId: `${this.room.name}:${participant.identity}`,
      patientId: participant.identity,
      transcript: '',
      normalizedTranscript: '',
      responseText: turn.responseText,
      toolCalls: turn.toolCalls.map((tool) => tool.name),
      ttfbMs: undefined,
      timestampIso: new Date().toISOString(),
      language: turn.language,
    });

    const audio = await synthesizeSpeech(turn.responseText, turn.language);
    await this.enqueueAudio(audio);
    logger.info('voice', 'greeting_audio_played', {
      room: this.room.name,
      participantIdentity: participant.identity,
      audioBytes: audio.byteLength,
    });
  }

  private enqueueAudio(ttsBuffer: Uint8Array): Promise<void> {
    const task = this.playbackChain.then(() => this.playAudio(ttsBuffer));
    this.playbackChain = task
      .catch((error) => {
        logger.warn('voice', 'playback_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .then(() => undefined);
    return task;
  }

  private async playAudio(ttsBuffer: Uint8Array): Promise<void> {
    this.agentPlaying = true;
    try {
      if (!ttsBuffer.length || !this.audioSource) return;
      logger.debug('voice', 'play_audio_start', { bytes: ttsBuffer.byteLength });
      const wav = new WaveFile(ttsBuffer);
      wav.toSampleRate(24000);
      wav.toBitDepth('16');
      const samples = wav.getSamples(false, Int16Array) as unknown as Int16Array;
      await this.audioSource.captureFrame(new AudioFrame(samples, 24000, 1, samples.length));
      await this.audioSource.waitForPlayout();
      logger.debug('voice', 'play_audio_complete', { samples: samples.length });
    } catch (error) {
      logger.error('voice', 'play_audio_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.agentPlaying = false;
    }
  }

  private framesToWav(frames: AudioFrame[]): Uint8Array {
    logger.debug('voice', 'frames_to_wav', {
      frames: frames.length,
      sampleRate: frames[0]?.sampleRate || null,
    });
    const totalSamples = frames.reduce((sum, frame) => sum + frame.data.byteLength / 2, 0);
    const combined = new Int16Array(totalSamples);
    let offset = 0;
    for (const frame of frames) {
      const pcm16 = new Int16Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength / 2);
      combined.set(pcm16, offset);
      offset += pcm16.length;
    }

    const wav = new WaveFile();
    wav.fromScratch(1, frames[0].sampleRate, '16', combined);
    return wav.toBuffer();
  }

  private async publishTrace(payload: unknown): Promise<void> {
    if (!this.room?.localParticipant) return;
    logger.debug('voice', 'publish_trace', { room: this.room.name, payload });
    await this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
      reliable: true,
      topic: 'maya.trace',
    });
  }

  private async askToRepeat(participant: Participant, language: 'en' | 'hi' | 'ta', source: 'audio' | 'text'): Promise<void> {
    if (!this.room?.localParticipant) return;

    const responseByLanguage: Record<'en' | 'hi' | 'ta', string> = {
      en: 'Sorry, I did not catch that. Please repeat once more.',
      hi: 'माफ़ कीजिए, मैं ठीक से सुन नहीं पाई। कृपया एक बार फिर बोलिए।',
      ta: 'மன்னிக்கவும், நான் தெளிவாக கேட்கவில்லை. தயவுசெய்து மீண்டும் சொல்லுங்கள்.',
    };
    const responseText = responseByLanguage[language];

    logger.info('voice', 'repeat_requested', {
      room: this.room.name,
      participantIdentity: participant.identity,
      source,
      language,
      responsePreview: responseText,
    });

    await this.room.localParticipant.sendChatMessage(responseText, [participant.identity]);
    const speech = await synthesizeSpeech(responseText, language);
    await this.enqueueAudio(speech);
  }
}

function normalizeLanguage(language?: string): 'en' | 'hi' | 'ta' {
  if (language === 'hi' || language === 'ta' || language === 'en') return language;
  return 'en';
}

function isLowValueTranscript(text: string, confidence?: number): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  if (/^(noise|noisy|unknown|silence|inaudible|um+|uh+|hmm+)$/.test(normalized)) return true;
  if (normalized.length < 2) return true;
  if (typeof confidence === 'number' && confidence < 0.55) return true;
  return false;
}
