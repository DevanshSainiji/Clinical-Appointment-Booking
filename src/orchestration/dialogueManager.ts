import { getSessionMemory, updateSessionMemory } from '../memory/sessionMemory.js';
import type { AppointmentIntent, LanguageCode } from './intentRouter.js';

export type DialogueState = {
  intent: AppointmentIntent;
  language: LanguageCode;
  needsDoctorId: boolean;
  needsDate: boolean;
};

export function buildDialogueState(
  sessionId: string,
  intent: AppointmentIntent,
  language: LanguageCode,
  userText: string,
): DialogueState {
  const existing = getSessionMemory(sessionId);
  const hasDoctorId = /\bdr[\s.-]?\w+|\bdoc[-_ ]?\d+/i.test(userText);
  const hasDate = /\b\d{4}-\d{2}-\d{2}\b/.test(userText);

  const nextState: DialogueState = {
    intent,
    language,
    needsDoctorId: intent !== 'cancel' && !hasDoctorId,
    needsDate: !hasDate,
  };

  updateSessionMemory(sessionId, {
    intent,
    language,
    lastUserText: userText,
    slotDoctorProvided: hasDoctorId || existing.slotDoctorProvided,
    slotDateProvided: hasDate || existing.slotDateProvided,
  });

  return nextState;
}
