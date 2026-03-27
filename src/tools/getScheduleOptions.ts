export type ScheduleRequest = {
  patientId: string;
};

export type ScheduleOption = {
  slotId: string;
  doctorId: string;
  startIso: string;
};

export const OPEN_SLOTS: ScheduleOption[] = [
  { slotId: 'slot-1', doctorId: 'doc-1', startIso: '2026-03-29T10:00:00Z' },
  { slotId: 'slot-2', doctorId: 'doc-1', startIso: '2026-03-29T11:30:00Z' },
];

export async function getScheduleOptions(_request: ScheduleRequest): Promise<ScheduleOption[]> {
  return OPEN_SLOTS;
}

export function resolveSlot(slotId: string): ScheduleOption | null {
  return OPEN_SLOTS.find((slot) => slot.slotId === slotId) ?? null;
}
