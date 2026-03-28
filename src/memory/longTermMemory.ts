import { mutateStore, loadStore } from '../storage/clinicStore.js';
import type { LanguageCode, InteractionSummary, PatientProfile } from '../domain/clinic.js';
import { logger } from '../telemetry/logger.js';

export async function getPatientProfile(patientId: string): Promise<PatientProfile> {
  const store = await loadStore();
  const found = store.patients.find((patient) => patient.patientId === patientId);
  if (found) {
    logger.debug('memory', 'patient_profile_loaded', {
      patientId,
      preferredLanguage: found.preferredLanguage,
      preferredDoctorId: found.preferredDoctorId || null,
    });
    return found;
  }

  const fallback: PatientProfile = {
    patientId,
    name: `Patient ${patientId}`,
    preferredLanguage: 'en',
  };
  await mutateStore((store2) => {
    store2.patients.push(fallback);
  });
  logger.warn('memory', 'patient_profile_seeded', { patientId, preferredLanguage: fallback.preferredLanguage });
  return fallback;
}

export async function upsertPatientProfile(profile: PatientProfile): Promise<PatientProfile> {
  await mutateStore((store) => {
    const index = store.patients.findIndex((patient) => patient.patientId === profile.patientId);
    if (index >= 0) store.patients[index] = profile;
    else store.patients.push(profile);
  });
  logger.info('memory', 'patient_profile_saved', {
    patientId: profile.patientId,
    preferredLanguage: profile.preferredLanguage,
    preferredDoctorId: profile.preferredDoctorId || null,
  });
  return profile;
}

export async function appendInteractionSummary(summary: InteractionSummary): Promise<void> {
  await mutateStore((store) => {
    store.interactions.unshift(summary);
    store.interactions = store.interactions.slice(0, 100);
  });
  logger.debug('memory', 'interaction_summary_appended', {
    patientId: summary.patientId,
    sessionId: summary.sessionId,
    language: summary.language,
  });
}

export async function getInteractionSummaries(patientId: string): Promise<InteractionSummary[]> {
  const store = await loadStore();
  return store.interactions.filter((item) => item.patientId === patientId).slice(0, 10);
}

export async function setPreferredLanguage(patientId: string, language: LanguageCode): Promise<void> {
  const profile = await getPatientProfile(patientId);
  await upsertPatientProfile({
    ...profile,
    preferredLanguage: language,
  });
  logger.info('memory', 'preferred_language_updated', { patientId, language });
}
