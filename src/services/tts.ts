import type { LanguageCode } from '../domain/clinic.js';
import { logger } from '../telemetry/logger.js';

export async function synthesizeSpeech(text: string, language: LanguageCode): Promise<Uint8Array> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    logger.error('tts', 'missing_api_key');
    throw new Error('SARVAM_API_KEY is required for text-to-speech.');
  }

  const targetLanguageCode = language === 'hi' ? 'hi-IN' : language === 'ta' ? 'ta-IN' : 'en-IN';
  logger.info('tts', 'request_start', { language, targetLanguageCode, textPreview: text.slice(0, 200) });

  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: [text],
      target_language_code: targetLanguageCode,
      pace: 1,
      speech_sample_rate: 8000,
      enable_preprocessing: true,
    }),
  });

  if (!response.ok) {
    logger.error('tts', 'request_failed', { status: response.status });
    throw new Error(`Sarvam TTS failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { audios?: string[] };
  const audio = data.audios?.[0];
  if (!audio) {
    logger.error('tts', 'empty_audio');
    throw new Error('Sarvam TTS returned no audio data.');
  }

  logger.info('tts', 'request_complete', { bytes: Buffer.from(audio, 'base64').byteLength });
  return Buffer.from(audio, 'base64');
}
