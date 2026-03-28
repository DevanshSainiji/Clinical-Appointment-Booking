import type { LanguageCode } from '../orchestration/intentRouter.js';

export type SttResult = {
  text: string;
  language: LanguageCode;
};

export async function transcribeAudio(audio: Uint8Array): Promise<SttResult> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (apiKey) {
    const response = await fetch('https://api.sarvam.ai/stt', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: audio as unknown as BodyInit,
    });

    if (response.ok) {
      const result = (await response.json()) as { text?: string; language?: string };
      const text = result.text?.trim() ?? '';
      return {
        text,
        language: normalizeLanguage(result.language) ?? detectLanguage(text),
      };
    }
  }

  const text = new TextDecoder().decode(audio).trim();
  return {
    text,
    language: detectLanguage(text),
  };
}

function normalizeLanguage(language: string | undefined): LanguageCode | null {
  if (language === 'en' || language === 'hi' || language === 'ta') {
    return language;
  }
  return null;
}

function detectLanguage(text: string): LanguageCode {
  if (/[\u0B80-\u0BFF]/.test(text)) {
    return 'ta';
  }
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hi';
  }
  return 'en';
}
