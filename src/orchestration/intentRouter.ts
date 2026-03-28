export type LanguageCode = 'en' | 'hi' | 'ta';
export type AppointmentIntent = 'book' | 'reschedule' | 'cancel' | 'unknown';

export type RoutedIntent = {
  intent: AppointmentIntent;
  language: LanguageCode;
};

export function routeIntent(userText: string, languageHint: string | undefined): RoutedIntent {
  const text = userText.toLowerCase();
  const intent: AppointmentIntent = text.includes('reschedule')
    ? 'reschedule'
    : text.includes('cancel')
      ? 'cancel'
      : text.includes('book')
        ? 'book'
        : 'unknown';

  return {
    intent,
    language: normalizeLanguage(languageHint),
  };
}

function normalizeLanguage(languageHint: string | undefined): LanguageCode {
  if (languageHint === 'hi' || languageHint === 'ta') {
    return languageHint;
  }
  return 'en';
}
export type Intent = 'book' | 'reschedule' | 'cancel' | 'quote' | 'unknown';

export function detectIntent(text: string): Intent {
  const input = text.toLowerCase();
  if (input.includes('reschedule')) return 'reschedule';
  if (input.includes('cancel')) return 'cancel';
  if (input.includes('quote')) return 'quote';
  if (input.includes('book')) return 'book';
  return 'unknown';
}
