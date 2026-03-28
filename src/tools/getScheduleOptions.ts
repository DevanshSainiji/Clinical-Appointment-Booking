import { loadStore } from '../storage/clinicStore.js';
import type { ScheduleOption, ScheduleQuery, ToolResult } from '../domain/clinic.js';
import { logger } from '../telemetry/logger.js';

export async function getScheduleOptionsTool(query: ScheduleQuery): Promise<ToolResult> {
  logger.info('tool', 'get_schedule_options_start', query);
  const store = await loadStore();
  const now = new Date();
  const candidateSlots = store.slots.filter((slot) => {
    const startsAt = new Date(slot.startsAtIso);
    if (slot.status !== 'available') return false;
    if (startsAt <= now) return false;
    if (query.doctorId && slot.doctorId !== query.doctorId) return false;
    if (query.dateIso && !slot.startsAtIso.startsWith(query.dateIso.slice(0, 10))) return false;
    return true;
  });

  const options: ScheduleOption[] = candidateSlots.slice(0, 6).map((slot, index) => ({
    slotId: slot.slotId,
    doctorId: slot.doctorId,
    doctorName: slot.doctorName,
    startsAtIso: slot.startsAtIso,
    durationMinutes: slot.durationMinutes,
    location: slot.location,
    confidence: 1 - index * 0.1,
    reason: query.doctorId ? 'Matches preferred doctor' : 'Next available slot',
  }));

  return {
    ok: true,
    message: options.length ? 'Found available schedule options.' : 'No slots available for the requested criteria.',
    data: {
      query,
      options,
    },
  };
}
