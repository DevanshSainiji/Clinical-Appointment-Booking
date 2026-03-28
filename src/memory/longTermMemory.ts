export type AppointmentHistoryRecord = {
  patientId: string;
  summary: string;
  createdAtIso: string;
};

const historyByPatient = new Map<string, AppointmentHistoryRecord[]>();

export async function getAppointmentHistory(patientId: string): Promise<AppointmentHistoryRecord[]> {
  return historyByPatient.get(patientId) ?? [];
}

export async function appendAppointmentHistory(record: AppointmentHistoryRecord): Promise<void> {
  const list = historyByPatient.get(record.patientId) ?? [];
  list.push(record);
  historyByPatient.set(record.patientId, list);
}
