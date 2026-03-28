import type { AppointmentIntent, LanguageCode } from '../domain/clinic.js';

export type RoutedIntent = {
  intent: AppointmentIntent;
  language: LanguageCode;
  confidence: number;
};

export function routeIntent(userText: string, languageHint?: string): RoutedIntent {
  const text = userText.toLowerCase();
  let intent: AppointmentIntent = 'unknown';
  if (/\bcancel\b|\bdrop\b|\bstop\b|\bcancel\b|\bरद्द\b|\bரத்து\b/.test(text)) intent = 'cancel';
  else if (/\breschedule\b|\bmove\b|\bchange\b|\bshift\b|\bबदल\b|\bமாற்ற\b/.test(text)) intent = 'reschedule';
  else if (
    /\bbook\b|\bschedule\b|\bappointment\b|\bबुक\b|\bbuk\b|\bபுக்\b|\bbooking\b/.test(text)
  ) {
    intent = 'book';
  } else if (/\bremind\b|\bfollow[- ]?up\b|\bcampaign\b|\bयाद\b|\bநினைவூட்டு\b/.test(text)) {
    intent = 'campaign';
  }

  return {
    intent,
    language: normalizeLanguage(languageHint) ?? detectLanguage(text),
    confidence: intent === 'unknown' ? 0.32 : 0.83,
  };
}

export function detectLanguage(text: string): LanguageCode {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  return 'en';
}

function normalizeLanguage(languageHint?: string): LanguageCode | undefined {
  if (languageHint === 'hi' || languageHint === 'ta' || languageHint === 'en') return languageHint;
  return undefined;
}
