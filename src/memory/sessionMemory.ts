import type { AppointmentIntent, LanguageCode } from '../orchestration/intentRouter.js';

export type SessionState = {
  intent?: AppointmentIntent;
  language?: LanguageCode;
  lastUserText?: string;
  slotDoctorProvided?: boolean;
  slotDateProvided?: boolean;
};

const memoryBySession = new Map<string, SessionState>();

export function getSessionMemory(sessionId: string): SessionState {
  return memoryBySession.get(sessionId) ?? {};
}

export function updateSessionMemory(sessionId: string, patch: SessionState): SessionState {
  const merged = { ...getSessionMemory(sessionId), ...patch };
  memoryBySession.set(sessionId, merged);
  return merged;
}
