import { getPatientProfile, getInteractionSummaries } from '../memory/longTermMemory.js';
import type { ToolResult } from '../domain/clinic.js';
import { logger } from '../telemetry/logger.js';

export async function getPatientProfileTool(input: { patientId: string }): Promise<ToolResult> {
  logger.info('tool', 'get_patient_profile_start', { patientId: input.patientId });
  const profile = await getPatientProfile(input.patientId);
  const history = await getInteractionSummaries(input.patientId);
  logger.info('tool', 'get_patient_profile_end', {
    patientId: input.patientId,
    recentInteractions: history.length,
  });
  return {
    ok: true,
    message: `Loaded patient profile for ${profile.name}.`,
    data: {
      profile,
      recentInteractions: history,
    },
  };
}
