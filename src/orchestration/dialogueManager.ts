import type { AppointmentIntent, LanguageCode } from '../domain/clinic.js';
import { getSessionMemory, updateSessionMemory } from '../memory/sessionMemory.js';
import { routeIntent } from './intentRouter.js';

export type DialogueState = {
  sessionId: string;
  patientId: string;
  intent: AppointmentIntent;
  language: LanguageCode;
  needsDoctorId: boolean;
  needsDate: boolean;
  pendingConfirmation?: string;
  lastUserText?: string;
  lastAgentText?: string;
};

export async function buildDialogueState(
  sessionId: string,
  patientId: string,
  intent: AppointmentIntent,
  language: LanguageCode,
  userText: string,
  analysisText?: string,
): Promise<DialogueState> {
  const existing = await getSessionMemory(sessionId);
  const textForAnalysis = analysisText || userText;
  const hasDoctorId = /\bdr[\s.-]?\w+|\bdoctor\s+\w+|\bdoc[-_ ]?\d+/i.test(textForAnalysis);
  const hasDate = /\b\d{4}-\d{2}-\d{2}\b|\btomorrow\b|\btoday\b|\bnext week\b/i.test(textForAnalysis);
  const routed = routeIntent(textForAnalysis, language);
  const intentToUse =
    routed.intent !== 'unknown'
      ? routed.intent
      : existing.intent !== 'unknown'
        ? existing.intent
        : hasDoctorId || hasDate
          ? 'book'
          : 'unknown';

  const next: DialogueState = {
    sessionId,
    patientId,
    intent: intentToUse,
    language,
    needsDoctorId: intentToUse !== 'cancel' && !hasDoctorId && !existing.slotDoctorProvided,
    needsDate: intentToUse !== 'cancel' && !hasDate && !existing.slotDateProvided,
    pendingConfirmation: existing.pendingConfirmation,
    lastUserText: userText,
    lastAgentText: existing.lastAgentText,
  };

  await updateSessionMemory(sessionId, {
    patientId,
    intent: intentToUse,
    language,
    lastUserText: userText,
    lastNormalizedText: textForAnalysis,
    slotDoctorProvided: hasDoctorId || existing.slotDoctorProvided,
    slotDateProvided: hasDate || existing.slotDateProvided,
    pendingConfirmation: existing.pendingConfirmation,
  });

  return next;
}
