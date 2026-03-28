import { logger } from '../telemetry/logger.js';
import type { LanguageCode } from '../domain/clinic.js';

export type TranslationResult = {
  originalText: string;
  translatedText: string;
  sourceLanguageCode: string;
};

export async function translateForReasoning(text: string, language: LanguageCode): Promise<TranslationResult> {
  if (language === 'en') {
    return {
      originalText: text,
      translatedText: text,
      sourceLanguageCode: 'en-IN',
    };
  }

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    logger.warn('translation', 'missing_api_key', { language });
    return {
      originalText: text,
      translatedText: text,
      sourceLanguageCode: language === 'hi' ? 'hi-IN' : 'ta-IN',
    };
  }

  const sourceLanguageCode = language === 'hi' ? 'hi-IN' : 'ta-IN';
  logger.info('translation', 'request_start', {
    language,
    sourceLanguageCode,
    textPreview: text.slice(0, 200),
  });

  const response = await fetch('https://api.sarvam.ai/translate', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      input: text,
      source_language_code: sourceLanguageCode,
      target_language_code: 'en-IN',
      model: 'mayura:v1',
      mode: 'formal',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.warn('translation', 'request_failed', { status: response.status, bodyPreview: body.slice(0, 300) });
    return {
      originalText: text,
      translatedText: text,
      sourceLanguageCode,
    };
  }

  const data = (await response.json()) as {
    translated_text?: string;
    source_language_code?: string;
  };

  const translatedText = data.translated_text?.trim() || text;
  logger.info('translation', 'request_complete', {
    language,
    sourceLanguageCode: data.source_language_code || sourceLanguageCode,
    translatedPreview: translatedText.slice(0, 200),
  });

  return {
    originalText: text,
    translatedText,
    sourceLanguageCode: data.source_language_code || sourceLanguageCode,
  };
}
