import { loadStore, mutateStore } from '../storage/clinicStore.js';
import type { AppointmentIntent, LanguageCode, SessionMemory } from '../domain/clinic.js';
import { logger } from '../telemetry/logger.js';

export async function getSessionMemory(sessionId: string): Promise<SessionMemory> {
  const store = await loadStore();
  const existing = store.sessions.find((session) => session.sessionId === sessionId);
  if (existing) return existing;

  const fallback: SessionMemory = {
    sessionId,
    patientId: sessionId.split(':')[1] || sessionId,
    intent: 'unknown',
    language: 'en',
    updatedAtIso: new Date().toISOString(),
  };
  await mutateStore((store2) => {
    store2.sessions.push(fallback);
  });
  logger.info('memory', 'session_created', { sessionId, patientId: fallback.patientId });
  return fallback;
}

export async function updateSessionMemory(
  sessionId: string,
  patch: Partial<Omit<SessionMemory, 'sessionId' | 'updatedAtIso'>> & { patientId?: string },
): Promise<SessionMemory> {
  const updatedAtIso = new Date().toISOString();
  let next: SessionMemory = {
    sessionId,
    patientId: patch.patientId || sessionId.split(':')[1] || sessionId,
    intent: patch.intent || 'unknown',
    language: patch.language || 'en',
    pendingConfirmation: patch.pendingConfirmation,
    pendingDoctorId: patch.pendingDoctorId,
    pendingDoctorName: patch.pendingDoctorName,
    pendingDateIso: patch.pendingDateIso,
    pendingDateLabel: patch.pendingDateLabel,
    pendingSlotId: patch.pendingSlotId,
    lastUserText: patch.lastUserText,
    lastNormalizedText: patch.lastNormalizedText,
    lastAgentText: patch.lastAgentText,
    slotDoctorProvided: patch.slotDoctorProvided,
    slotDateProvided: patch.slotDateProvided,
    updatedAtIso,
  };
  await mutateStore((store) => {
    const index = store.sessions.findIndex((session) => session.sessionId === sessionId);
    const existing = index >= 0 ? store.sessions[index] : undefined;
    next = {
      sessionId,
      patientId: patch.patientId || existing?.patientId || sessionId.split(':')[1] || sessionId,
      intent: patch.intent || existing?.intent || 'unknown',
      language: patch.language || existing?.language || 'en',
      pendingConfirmation: patch.pendingConfirmation ?? existing?.pendingConfirmation,
      pendingDoctorId: patch.pendingDoctorId ?? existing?.pendingDoctorId,
      pendingDoctorName: patch.pendingDoctorName ?? existing?.pendingDoctorName,
      pendingDateIso: patch.pendingDateIso ?? existing?.pendingDateIso,
      pendingDateLabel: patch.pendingDateLabel ?? existing?.pendingDateLabel,
      pendingSlotId: patch.pendingSlotId ?? existing?.pendingSlotId,
      lastUserText: patch.lastUserText ?? existing?.lastUserText,
      lastNormalizedText: patch.lastNormalizedText ?? existing?.lastNormalizedText,
      lastAgentText: patch.lastAgentText ?? existing?.lastAgentText,
      slotDoctorProvided: patch.slotDoctorProvided ?? existing?.slotDoctorProvided,
      slotDateProvided: patch.slotDateProvided ?? existing?.slotDateProvided,
      updatedAtIso,
    };

    if (index >= 0) {
      store.sessions[index] = next;
    } else {
      store.sessions.push(next);
    }
  });
  logger.debug('memory', 'session_updated', {
    sessionId,
    patientId: next.patientId,
    intent: next.intent,
    language: next.language,
    hasPendingConfirmation: Boolean(next.pendingConfirmation),
  });
  return next!;
}

export async function rememberSessionIntent(
  sessionId: string,
  intent: AppointmentIntent,
  language: LanguageCode,
  patientId: string,
  userText: string,
): Promise<SessionMemory> {
  logger.info('memory', 'session_intent_remembered', { sessionId, patientId, intent, language });
  return updateSessionMemory(sessionId, {
    intent,
    language,
    patientId,
    lastUserText: userText,
    lastNormalizedText: userText,
  });
}

export async function clearSessionMemory(sessionId: string): Promise<void> {
  await mutateStore((store) => {
    store.sessions = store.sessions.filter((session) => session.sessionId !== sessionId);
  });
  logger.info('memory', 'session_cleared', { sessionId });
}

export async function clearPatientConversation(patientId: string): Promise<void> {
  await mutateStore((store) => {
    store.sessions = store.sessions.filter((session) => session.patientId !== patientId);
    store.interactions = store.interactions.filter((interaction) => interaction.patientId !== patientId);
  });
  logger.info('memory', 'patient_conversation_cleared', { patientId });
}
