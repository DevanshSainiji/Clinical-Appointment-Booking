import type { LanguageCode } from '../orchestration/intentRouter.js';
import { PatientModel } from '../models/patient.model.js';

export type PatientProfile = {
  patientId: string;
  name: string;
  preferredLanguage: LanguageCode;
  activeAppointmentId?: string;
};

export async function getPatientProfile(patientId: string): Promise<PatientProfile> {
  const patient = await PatientModel.findOne({ patientId }).lean();
  if (!patient) {
    return {
      patientId,
      name: 'Guest Patient',
      preferredLanguage: 'en',
    };
  }

  return {
    patientId,
    name: patient.name ?? 'Guest Patient',
    preferredLanguage: (patient.preferredLanguage ?? 'en') as LanguageCode,
  };
}
