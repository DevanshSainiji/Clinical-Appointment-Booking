import type { LanguageCode } from '../domain/clinic.js';
import { logger } from '../telemetry/logger.js';

export type SttResult = {
  text: string;
  language: LanguageCode;
  confidence?: number;
};

export async function transcribeAudio(audio: Uint8Array): Promise<SttResult> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    logger.error('stt', 'missing_api_key');
    throw new Error('SARVAM_API_KEY is required for speech recognition.');
  }

  logger.info('stt', 'request_start', { audioBytes: audio.byteLength });

  const form = new FormData();
  form.set('model', 'saaras:v3');
  form.set('mode', 'codemix');
  form.set('language_code', 'unknown');
  const ab = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  form.set('file', new Blob([ab], { type: 'audio/wav' }), 'audio.wav');

  const response = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
    },
    body: form,
  });

  if (!response.ok) {
    logger.error('stt', 'request_failed', { status: response.status });
    throw new Error(`Sarvam STT failed: ${response.status} ${await response.text()}`);
  }

  const result = (await response.json()) as {
    transcript?: string;
    language_code?: string;
    language_probability?: number | null;
  };

  const text = result.transcript?.trim() || '';
  return {
    text,
    language: normalizeLanguage(result.language_code) ?? detectLanguage(text),
    confidence: typeof result.language_probability === 'number' ? result.language_probability : undefined,
  };
}

function normalizeLanguage(languageCode?: string): LanguageCode | null {
  if (languageCode === 'en' || languageCode === 'hi' || languageCode === 'ta') return languageCode;
  if (languageCode?.startsWith('en')) return 'en';
  if (languageCode?.startsWith('hi')) return 'hi';
  if (languageCode?.startsWith('ta')) return 'ta';
  return null;
}

function detectLanguage(text: string): LanguageCode {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  return 'en';
}
